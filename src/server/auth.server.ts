// Server-only code for accounts: sign in, register, sessions and role checks.
// The ".server.ts" name keeps this file (and everything secret in it) out of the browser.
import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { Pool } from "pg";
import schemaSql from "../../db/schema.sql?raw";
import {
  DEMO_ACCOUNTS,
  ROLE_META,
  checkEmail,
  checkName,
  checkNewPassword,
  type AuthResult,
  type PublicInfo,
  type Role,
  type SessionResult,
  type SessionUser,
} from "../lib/auth-types";
import { getPool } from "./db.server";
import { describeError } from "./event.server";
import { burnTime, hashPassword, verifyPassword } from "./password.server";

const COOKIE = "eventops_session";
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 10;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const codeOf = (err: unknown) => (err as { code?: string }).code;

// ---------- Setup ----------

// Creates the account tables (and the demo accounts) when they are missing. Never deletes anything.
// Uses the same lock as the event setup, so two visitors arriving together cannot clash.
export async function ensureAuthSetup(): Promise<void> {
  const seedDemo = process.env['DEMO_ACCOUNTS'] !== "off";
  const demo = seedDemo
    ? await Promise.all(DEMO_ACCOUNTS.map(async (a) => ({ ...a, hash: await hashPassword(a.password) })))
    : [];

  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(727274)");
    await client.query(schemaSql);
    for (const a of demo) {
      await client.query(
        `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
         on conflict (email) do nothing`,
        [a.name, a.email, a.hash, a.role],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Runs some work; if the account tables are missing (an older database), sets them up and tries once more.
async function withSetup<T>(work: (db: Pool) => Promise<T>): Promise<T> {
  const db = getPool();
  try {
    return await work(db);
  } catch (err) {
    if (codeOf(err) !== "42P01") throw err;
    await ensureAuthSetup();
    return work(db);
  }
}

// ---------- Sessions ----------

async function startSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const db = getPool();
  await db.query("delete from sessions where user_id = $1 and expires_at < now()", [userId]);
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at)
     values ($1, $2, now() + make_interval(days => $3::int))`,
    [sha256(token), userId, SESSION_DAYS],
  );
  setCookie(COOKIE, token, {
    httpOnly: true, // page scripts can never read it
    sameSite: "lax", // other sites cannot send it with a form post
    secure: process.env['NODE_ENV'] === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

// Who is signed in on this request, or null. Throws only when the database cannot be reached.
export async function currentUser(): Promise<SessionUser | null> {
  const token = getCookie(COOKIE);
  if (!token) return null;
  try {
    const r = await getPool().query<SessionUser>(
      `select u.id, u.name, u.email, u.role
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    );
    return r.rows[0] ?? null;
  } catch (err) {
    if (codeOf(err) === "42P01") return null; // tables not created yet, so nobody can be signed in
    throw err;
  }
}

export async function readSession(): Promise<SessionResult> {
  try {
    return { ok: true, user: await currentUser() };
  } catch (err) {
    console.error("[auth] session check failed:", err);
    return { ok: false, ...describeError(err) };
  }
}

export async function logout(): Promise<{ ok: true }> {
  const token = getCookie(COOKIE);
  deleteCookie(COOKIE, { path: "/" });
  if (token) await getPool().query("delete from sessions where token_hash = $1", [sha256(token)]).catch(() => {});
  return { ok: true };
}

// ---------- Role checks ----------

type Denied = { ok: false; problem: string; hint: string };

// The one place that decides "is this person allowed to do this?". Every protected server call goes through it.
export async function authorize(roles: readonly Role[]): Promise<{ ok: true; user: SessionUser } | Denied> {
  const user = await currentUser();
  if (!user) return { ok: false, problem: "You are signed out.", hint: "Sign in again to continue." };
  if (!roles.includes(user.role))
    return {
      ok: false,
      problem: "This account cannot do that.",
      hint: `That needs ${roles.map((r) => ROLE_META[r].label).join(" or ")} access.`,
    };
  return { ok: true, user };
}

// Checks the role, then runs the work, and always answers with a result object instead of throwing.
export async function guarded<T>(
  roles: readonly Role[],
  work: (user: SessionUser) => Promise<T>,
): Promise<{ ok: true; data: T } | Denied> {
  try {
    const gate = await authorize(roles);
    if (!gate.ok) return gate;
    return { ok: true, data: await work(gate.user) };
  } catch (err) {
    console.error("[auth] guarded call failed:", err);
    const safeMessages = new Set([
      "Select an event",
      "Registration closed",
      "Already registered or event full",
      "Team name required",
      "Teams unavailable",
      "You already belong to a team for this event",
      "Team name already exists",
      "Team not found",
      "Team full or already joined"
    ]);
    if (err instanceof Error && safeMessages.has(err.message)) {
      return {
        ok: false,
        problem: err.message,
        hint: "Check your selection and try again."
      };
    }
    return { ok: false, ...describeError(err) };
  }
}

// ---------- Sign in ----------

type LoginRow = SessionUser & { password_hash: string; failed_logins: number; locked_until: Date | null };

const WRONG_LOGIN: AuthResult = {
  ok: false,
  problem: "Email or password is incorrect.",
  hint: "Check both and try again. Passwords are case sensitive.",
};

function lockedMessage(until: Date): AuthResult {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return {
    ok: false,
    problem: "Too many wrong attempts.",
    hint: `This account is paused for ${minutes} more minute${minutes === 1 ? "" : "s"}. Try again then.`,
  };
}

async function authSafely(work: () => Promise<AuthResult>): Promise<AuthResult> {
  try {
    return await work();
  } catch (err) {
    console.error("[auth] failed:", err);
    return { ok: false, ...describeError(err) };
  }
}

export function login(emailInput: string, password: string, role: Role): Promise<AuthResult> {
  return authSafely(async () => {
    const email = emailInput.trim().toLowerCase();
    if (checkEmail(email) || !password) return WRONG_LOGIN;

    const row = await withSetup(async (db) => {
      const r = await db.query<LoginRow>(
        `select id, name, email, role, password_hash, failed_logins, locked_until from users where email = $1`,
        [email],
      );
      return r.rows[0];
    });

    if (!row) {
      await burnTime(password); // same delay as a real check
      return WRONG_LOGIN;
    }
    if (row.locked_until && row.locked_until.getTime() > Date.now()) return lockedMessage(row.locked_until);

    if (!(await verifyPassword(password, row.password_hash))) {
      // One statement counts the failure and starts the pause on the 5th, even if attempts overlap.
      const r = await getPool().query<{ locked_until: Date | null }>(
        `update users set
           failed_logins = case when locked_until is not null and locked_until <= now() then 1 else failed_logins + 1 end,
           locked_until = case
             when (case when locked_until is not null and locked_until <= now() then 1 else failed_logins + 1 end) >= $2
             then now() + make_interval(mins => $3::int) else null end
         where id = $1
         returning locked_until`,
        [row.id, MAX_FAILED_LOGINS, LOCK_MINUTES],
      );
      const until = r.rows[0]?.locked_until;
      return until && until.getTime() > Date.now() ? lockedMessage(until) : WRONG_LOGIN;
    }

    // The password is right. Only now is it safe to say which role the account really has.
    if (row.role !== role)
      return {
        ok: false,
        problem: `This is ${row.role === "admin" ? "an" : "a"} ${ROLE_META[row.role].label} account.`,
        hint: `Choose the ${ROLE_META[row.role].short} pass to sign in with it.`,
        suggestRole: row.role,
      };

    await getPool().query("update users set failed_logins = 0, locked_until = null where id = $1", [row.id]);
    await startSession(row.id);
    return { ok: true, user: { id: row.id, name: row.name, email: row.email, role: row.role } };
  });
}

// ---------- Create accounts ----------

function checkNewAccount(name: string, email: string, password: string): AuthResult | null {
  const nameMsg = checkName(name);
  if (nameMsg) return { ok: false, field: "name", problem: nameMsg, hint: "Use the name people know you by." };
  const emailMsg = checkEmail(email);
  if (emailMsg) return { ok: false, field: "email", problem: emailMsg, hint: "We use it to sign you in." };
  const passMsg = checkNewPassword(password);
  if (passMsg) return { ok: false, field: "password", problem: passMsg, hint: "Pick something others cannot guess." };
  return null;
}

async function createAccount(
  name: string,
  email: string,
  password: string,
  role: Role,
  signIn: boolean,
): Promise<AuthResult> {
  const hash = await hashPassword(password);
  try {
    const user = await withSetup(async (db) => {
      const r = await db.query<SessionUser>(
        `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
         returning id, name, email, role`,
        [name, email, hash, role],
      );
      return r.rows[0];
    });
    if (!user) throw new Error("INSERT_FAILED");
    if (signIn) await startSession(user.id);
    return { ok: true, user };
  } catch (err) {
    if (codeOf(err) === "23505")
      return {
        ok: false,
        field: "email",
        problem: "That email already has an account.",
        hint: "Sign in instead, or use a different email.",
      };
    throw err;
  }
}

// Participants register themselves and are signed in straight away.
export function register(nameInput: string, emailInput: string, password: string): Promise<AuthResult> {
  return authSafely(async () => {
    const name = nameInput.trim();
    const email = emailInput.trim().toLowerCase();
    return checkNewAccount(name, email, password) ?? createAccount(name, email, password, "participant", true);
  });
}

// Administrators create other accounts (volunteers, more administrators). The caller stays signed in as themselves.
export function createUser(
  nameInput: string,
  emailInput: string,
  password: string,
  role: Role,
): Promise<AuthResult> {
  return authSafely(async () => {
    const gate = await authorize(["admin"]);
    if (!gate.ok) return gate;
    const name = nameInput.trim();
    const email = emailInput.trim().toLowerCase();
    return checkNewAccount(name, email, password) ?? createAccount(name, email, password, role, false);
  });
}

// ---------- Public information for the entry page ----------

// Event name and start time are not secret, so the entry page may show a countdown before sign-in.
// Any problem just means "no countdown": the sign-in form must never depend on this.
export async function publicInfo(): Promise<PublicInfo> {
  const demoLogins = process.env['DEMO_ACCOUNTS'] !== "off";
  try {
    const r = await getPool().query<{ name: string; start_ms: number }>(
      `select name, floor(extract(epoch from starts_at) * 1000)::float8 as start_ms
         from events order by id limit 1`,
    );
    const e = r.rows[0];
    return { event: e ? { name: e.name, startsAt: e.start_ms } : null, demoLogins };
  } catch {
    return { event: null, demoLogins };
  }
}
