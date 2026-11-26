// Server-only code that reads and changes event data in PostgreSQL.
// The ".server.ts" name keeps this file (and the secret connection) out of the browser.
import type { Pool, PoolClient } from "pg";
import resetSql from "../../db/reset.sql?raw";
import schemaSql from "../../db/schema.sql?raw";
import seedSql from "../../db/seed.sql?raw";
import type { Expense, EventData, Priority, Severity, TaskStatus } from "../lib/event-data";
import { getPool } from "./db.server";

export type ApiProblem = { problem: string; hint: string };
export type ApiResult = { ok: true; data: EventData } | ({ ok: false } & ApiProblem);

// Turns a database error into a plain-English message. Full details go to the server log only.
export function describeError(err: unknown): ApiProblem {
  const e = err as { message?: string; code?: string };
  if (e.message === "DATABASE_URL_MISSING")
    return {
      problem: "The server has no DATABASE_URL.",
      hint: "Locally: put it in the .env file and restart npm run dev. On Vercel: add it under Settings, Environment Variables, then redeploy.",
    };
  if (e.code === "42P01")
    return {
      problem: "Connected to the database, but the tables do not exist yet.",
      hint: "The automatic setup did not finish. Run npm run db:setup once, then try again.",
    };
  if (e.code === "28P01" || e.code === "28000")
    return {
      problem: "The database refused the username or password.",
      hint: "Copy the connection string from Neon again and paste the whole thing into DATABASE_URL.",
    };
  if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "ECONNRESET")
    return {
      problem: "Could not reach the database server.",
      hint: "Try again in a few seconds in case the database is still waking up.",
    };
  if (e.message === "TASK_CHANGED")
    return {
      problem: "That task was changed by someone else.",
      hint: "Your list has been refreshed. Check it and try again.",
    };
  if (e.message === "NOTE_REQUIRED")
    return { problem: "Say what is blocking you.", hint: "Add a short reason so the administrator can help." };
  if (e.message === "NOTE_EMPTY")
    return { problem: "Write a note first.", hint: "A note can be up to 500 characters." };
  if (e.message === "SLOT_OVERLAP")
    return { problem: "That overlaps another shift for this volunteer.", hint: "Pick a different time or remove the other shift first." };
  if (e.message === "SHIFT_INVALID")
    return { problem: "Those shift times do not work.", hint: "Pick an end time after the start, for at most 16 hours." };
  if (e.message === "ALREADY_ON_DUTY")
    return { problem: "You are already checked in.", hint: "Your screen has been refreshed." };
  if (e.message === "NOT_ON_DUTY")
    return { problem: "You are not checked in.", hint: "Your screen has been refreshed." };
  if (e.message === "INVALID_VOLUNTEER")
    return { problem: "That person is not a volunteer.", hint: "Pick someone from the volunteer list." };
  if (e.message === "NOT_FOUND")
    return { problem: "That item no longer exists.", hint: "The page has been refreshed with the latest data." };
  return {
    problem: "Something unexpected went wrong talking to the database.",
    hint: "Check the server log (terminal or Vercel Logs) for details.",
  };
}

// Runs some database work and always returns a result object instead of throwing.
export async function safely(work: () => Promise<EventData>): Promise<ApiResult> {
  try {
    return { ok: true, data: await work() };
  } catch (err) {
    console.error("[event-api] failed:", err);
    return { ok: false, ...describeError(err) };
  }
}

type Db = Pick<Pool, "query">;

// Creates any missing tables and adds the sample data if the database is empty.
// Safe to run at any time and by anyone: it only ADDS what is missing and never deletes anything.
// The lock makes sure two visitors arriving at the same moment cannot set things up twice.
export async function ensureSetup(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(727274)");
    await client.query(schemaSql);
    await client.query(seedSql);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Runs some read. If tables are missing (new database) or a newer column is missing (older database),
// runs the safe setup once and tries again. Used by every screen that reads event data.
export async function withEventSetup<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P01" && code !== "42703") throw err;
    await ensureSetup();
    return work();
  }
}

// Reads everything the dashboard needs. If the database is new or out of date, sets it up first.
export async function loadEventData(db: Db = getPool()): Promise<EventData> {
  return withEventSetup(() => readEventData(db));
}

async function readEventData(db: Db): Promise<EventData> {
  const [ev, tasks, resources, issues, budget, expenses, sponsors, schedule, activity] = await Promise.all([
    db.query<{ name: string; start_ms: number; resolved_before: number }>(
      `select name, floor(extract(epoch from starts_at) * 1000)::float8 as start_ms,
              issues_resolved_before as resolved_before
         from events order by id limit 1`,
    ),
    db.query<{ id: number; title: string; owner: string; due: string; priority: Priority; status: TaskStatus; note: string }>(
      `select id, title, owner, coalesce(to_char(due, 'YYYY-MM-DD'), '') as due, priority, status, note
         from tasks order by id`,
    ),
    db.query<{ id: number; name: string; kind: "venue" | "gear"; slot: string; status: "Booked" | "Pending" | "Conflict" | "Free" }>(
      `select id, name, kind, slot, status from resources order by id`,
    ),
    db.query<{ id: number; title: string; severity: Severity; status: "Open" | "Resolved" }>(
      `select id, title, severity, status from issues
        order by array_position(array['Critical','High','Medium','Low'], severity), id desc`,
    ),
    db.query<{ id: number; head: string; total: number; spent: number }>(
      `select c.id, c.head, c.planned_amount as total, coalesce(sum(e.amount), 0)::int as spent
         from budget_categories c left join expenses e on e.category_id = c.id
        group by c.id order by c.id`,
    ),
    db.query<Expense>(
      `select e.id, e.category_id as "categoryId", e.amount, e.note,
              to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn"
         from expenses e join budget_categories c on c.id = e.category_id
        where c.event_id = (select id from events order by id limit 1)
        order by e.spent_on desc, e.id desc`,
    ),
    db.query<{ id: number; name: string; amount: number; status: "Paid" | "Pending"; note: string }>(
      `select id, name, amount, status, note from sponsors order by id`,
    ),
    db.query<{ id: number; title: string; venue: string; at: number }>(
      `select id, title, venue, floor(extract(epoch from starts_at) * 1000)::float8 as at
         from schedule_items order by starts_at`,
    ),
    db.query<{ id: number; text: string; at: number }>(
      `select id, text, floor(extract(epoch from created_at) * 1000)::float8 as at
         from activity order by id desc limit 20`,
    ),
  ]);

  const event = ev.rows[0];
  if (!event) throw Object.assign(new Error("NO_EVENT"), { code: "42P01" }); // empty database: needs setup

  return {
    eventName: event.name,
    eventStart: event.start_ms,
    resolvedEarlier: event.resolved_before,
    tasks: tasks.rows,
    resources: resources.rows,
    issues: issues.rows,
    budget: budget.rows,
    expenses: expenses.rows,
    sponsors: sponsors.rows,
    schedule: schedule.rows,
    activity: activity.rows,
  };
}

// Runs a change inside a transaction (all or nothing), then returns the fresh data.
async function change(work: (c: PoolClient, eventId: number) => Promise<void>): Promise<EventData> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ev = await client.query<{ id: number }>("select id from events order by id limit 1");
    const eventId = ev.rows[0]?.id;
    if (eventId === undefined) throw Object.assign(new Error("NO_EVENT"), { code: "42P01" });
    await work(client, eventId);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return loadEventData(pool);
}

const log = (c: PoolClient, eventId: number, text: string) =>
  c.query("insert into activity (event_id, text) values ($1, $2)", [eventId, text]);

export const createTask = (title: string, priority: Priority, due: string) =>
  change(async (c, eventId) => {
    await c.query(
      `insert into tasks (event_id, title, owner, due, priority, status)
       values ($1, $2, 'You', nullif($3, '')::date, $4, 'Backlog')`,
      [eventId, title, due, priority],
    );
    await log(c, eventId, `Task added: ${title}`);
  });

export const setTaskStatus = (id: number, status: TaskStatus) =>
  change(async (c, eventId) => {
    const r = await c.query<{ title: string }>(
      `update tasks set status = $2, note = case when $2::text = 'Blocked' then note else '' end, updated_at = now()
        where id = $1 returning title`,
      [id, status],
    );
    const task = r.rows[0];
    if (!task) throw new Error("NOT_FOUND");
    await log(c, eventId, `${task.title} moved to ${status}`);
  });

export const createExpense = (categoryId: number, amount: number, note: string, spentOn: string) =>
  change(async (c, eventId) => {
    const r = await c.query(
      `insert into expenses (category_id, amount, note, spent_on)
       select id, $2, $3, $4::date from budget_categories
        where id = $1 and event_id = $5 returning id`,
      [categoryId, amount, note, spentOn, eventId],
    );
    if (!r.rows.length) throw new Error("NOT_FOUND");
    await log(c, eventId, `Expense added: ${note || amount}`);
  });

export const createIssue = (title: string, severity: Severity) =>
  change(async (c, eventId) => {
    await c.query("insert into issues (event_id, title, severity) values ($1, $2, $3)", [eventId, title, severity]);
    await log(c, eventId, `Issue logged: ${title}`);
  });

export const resolveIssue = (id: number) =>
  change(async (c, eventId) => {
    const r = await c.query<{ title: string }>(
      "update issues set status = 'Resolved', resolved_at = now() where id = $1 and status = 'Open' returning title",
      [id],
    );
    const issue = r.rows[0];
    if (!issue) throw new Error("NOT_FOUND");
    await log(c, eventId, `Issue resolved: ${issue.title}`);
  });

// Deletes ALL event data and loads the sample data again (dates counted from today).
export async function resetDemoData(): Promise<EventData> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(727274)");
    await client.query(schemaSql);
    await client.query(resetSql);
    await client.query(seedSql);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return loadEventData(pool);
}
