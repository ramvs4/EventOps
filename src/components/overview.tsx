import { EventCatalog } from "./event-catalog";
import { CheckCircle2, ClipboardCheck, Clock, IndianRupee, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { countdown, quickStats, timeAgo } from "@/lib/event-selectors";
import { useEventStore } from "@/lib/event-store";
import { PageHeader, StatusBadge, StatusDot, type Tone } from "./admin-ui";
import { MissionBrief } from "./mission-brief";
import { VolunteerSummary } from "./volunteers/volunteer-summary";

const runSheet = [
  { label: "Main auditorium unlocked", done: true },
  { label: "Sound lab patch verified", done: true },
  { label: "Gate scanners connected", done: true },
  { label: "Green room stocked", done: false },
];

export function Overview() {
  const { state, now, resetDemo } = useEventStore();
  const [dialog, setDialog] = useState<null | "runsheet" | "sponsors" | "reset">(null);
  const [resetting, setResetting] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const [checks, setChecks] = useState(runSheet.map((r) => r.done));
  const close = (isOpen: boolean) => {
    if (!isOpen) setDialog(null);
  };

  const secured = state.sponsors.filter((x) => x.status === "Paid").reduce((sum, x) => sum + x.amount, 0);
  const pendingMoney = state.sponsors.filter((x) => x.status === "Pending").reduce((sum, x) => sum + x.amount, 0);
  const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const doReset = async () => {
    setResetting(true);
    setResetFailed(false);
    const ok = await resetDemo();
    setResetting(false);
    if (ok) setDialog(null);
    else setResetFailed(true);
  };

  const q = quickStats(state);
  const stats: { label: string; value: string; tone: Tone }[] = [
    { label: "Open tasks", value: String(q.openTasks), tone: "neutral" },
    {
      label: "Bookings confirmed",
      value: `${q.bookingsConfirmed}/${q.bookingsAsked}`,
      tone: q.conflicts > 0 ? "warning" : "success",
    },
    { label: "Live issues", value: String(q.liveIssues), tone: q.liveIssues > 0 ? "danger" : "success" },
    { label: "Budget used", value: `${q.budgetPct}%`, tone: q.budgetPct >= 85 ? "warning" : "neutral" },
  ];

  const upcoming = state.schedule.filter((s) => s.at >= now).sort((a, b) => a.at - b.at).slice(0, 4);
  const next = upcoming[0];

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${state.eventName} — where things stand right now.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("runsheet")}>
              <ClipboardCheck /> Friday run-sheet
            </Button>
            <Button variant="outline" onClick={() => setDialog("sponsors")}>
              <IndianRupee /> Sponsor pulse
            </Button>
            <Button variant="ghost" onClick={() => setDialog("reset")}>
              <RotateCcw /> Reset demo data
            </Button>
          </div>
        }
      />

      <EventCatalog />
      <MissionBrief />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusDot tone={s.tone} /> {s.label}
            </p>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <VolunteerSummary />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="mb-4 text-base font-semibold">Coming up</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
          ) : (
            <ol className="grid gap-3">
              {upcoming.map((item) => {
                const c = countdown(item.at - now);
                return (
                  <li key={item.id} className="flex items-start gap-3">
                    <p className="w-24 shrink-0 text-sm font-medium tabular-nums">
                      {new Date(item.at).toLocaleString("en-IN", {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.venue}</p>
                    </div>
                    {item.id === next?.id && (
                      <StatusBadge tone="info">
                        in {c.days > 0 ? `${c.days}d ` : ""}
                        {c.hours}h
                      </StatusBadge>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="mb-4 text-base font-semibold">Recent activity</h2>
          <ul className="grid gap-3">
            {state.activity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <StatusDot tone="neutral" className="mt-1.5" />
                <p className="min-w-0 flex-1 text-sm leading-snug">{a.text}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{timeAgo(now - a.at)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog open={dialog === "runsheet"} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Friday run-sheet</DialogTitle>
            <DialogDescription>Venue checks before the gates open.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {runSheet.map((r, idx) => (
              <button
                key={r.label}
                type="button"
                aria-pressed={checks[idx]}
                onClick={() => setChecks((c) => c.map((v, i) => (i === idx ? !v : v)))}
                className="flex items-center gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent"
              >
                {checks[idx] ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <Clock className="h-5 w-5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{r.label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "sponsors"} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sponsor pulse</DialogTitle>
            <DialogDescription>Current commitments and payment status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-4">
                <p className="text-sm text-muted-foreground">Secured</p>
                <p className="font-display text-2xl font-bold tabular-nums">{rupees(secured)}</p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="font-display text-2xl font-bold tabular-nums">{rupees(pendingMoney)}</p>
              </div>
            </div>
            {state.sponsors.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{rupees(s.amount)}</p>
                </div>
                <StatusBadge tone={s.status === "Paid" ? "success" : "warning"}>
                  {s.note || s.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    
      <Dialog open={dialog === "reset"} onOpenChange={(o) => !resetting && close(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset demo data?</DialogTitle>
            <DialogDescription>
              This deletes every task, booking, issue, expense and activity entry, and loads fresh sample
              data with dates counted from today. Use it to get the demo back to a clean start.
            </DialogDescription>
          </DialogHeader>
          {resetFailed && (
            <p role="alert" className="text-sm text-destructive">
              The reset did not work. Nothing was changed. Please try again.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={resetting} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={resetting} onClick={doReset}>
              {resetting ? "Resetting…" : "Yes, reset everything"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
