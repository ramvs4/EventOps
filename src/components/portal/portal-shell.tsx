import { CalendarCheck, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { RoleGuard } from "@/components/auth/role-guard";
import { ThemeToggle } from "@/components/theme-toggle";
import { ROLE_META } from "@/lib/auth-types";
import { signOut, useSession } from "@/lib/session";

type PortalRole = "volunteer" | "participant";

function Frame({ role, children }: { role: PortalRole; children: ReactNode }) {
  const { state } = useSession();
  const user = state.status === "ready" ? state.user : null;
  const meta = ROLE_META[role];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CalendarCheck className="h-4 w-4" />
        </span>
        <span className="font-display text-lg font-bold">EventOps</span>
        <span
          className="rounded-md px-2.5 py-1 text-xs font-semibold text-white"
          style={{ backgroundColor: meta.solid }}
        >
          {meta.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {user && <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.name}</span>}
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </button>
        </div>
      </header>
      <main className={role === "participant" ? "w-full min-w-0 p-0" : "mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8"}>{children}</main>
    </div>
  );
}

// Shared frame for the Volunteer and Participant modules: only that role gets in.
export function PortalShell({ role, children }: { role: PortalRole; children: ReactNode }) {
  return (
    <RoleGuard role={role}>
      <Frame role={role}>{children}</Frame>
    </RoleGuard>
  );
}
