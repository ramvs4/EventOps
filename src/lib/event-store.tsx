import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addExpenseApi,
  addIssueApi,
  addTaskApi,
  getEventData,
  resetDemoDataApi,
  resolveIssueApi,
  setTaskStatusApi,
  type ApiResult,
} from "./event-api";
import {
  EMPTY_STATE,
  TASK_STAGES,
  type EventData,
  type EventState,
  type Priority,
  type Severity,
} from "./event-data";

/*
  How data flows:
    1. The database is the source of truth. On load, the browser asks the server for everything.
    2. When you change something, the screen updates instantly (so it feels fast), then the change is
       saved on the server. The server answers with the real data, which replaces what is on screen.
    3. Items that are still being saved have a negative id and are shown as "Saving...".
*/

type Action =
  | { type: "replace"; data: EventData }
  | { type: "add_task"; title: string; priority: Priority; due: string; now: number }
  | { type: "move_task"; id: number; now: number }
  | { type: "add_issue"; title: string; severity: Severity; now: number }
  | { type: "add_expense"; categoryId: number; amount: number; note: string; spentOn: string; now: number }
  | { type: "resolve_issue"; id: number; now: number };

const tempId = (now: number) => -now;

function log(state: EventState, text: string, now: number) {
  return [{ id: tempId(now), text, at: now }, ...state.activity].slice(0, 20);
}

function reducer(state: EventState, action: Action): EventState {
  switch (action.type) {
    case "replace":
      return { ...action.data, ready: true };

    case "add_task":
      return {
        ...state,
        tasks: [
          ...state.tasks,
          {
            id: tempId(action.now),
            title: action.title,
            owner: "You",
            due: action.due,
            priority: action.priority,
            status: "Backlog",
            note: "",
          },
        ],
        activity: log(state, `Task added: ${action.title}`, action.now),
      };

    case "move_task": {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task) return state;
      const next = TASK_STAGES[TASK_STAGES.indexOf(task.status) + 1]; // Done has no next stage
      if (!next) return state;
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === task.id ? { ...t, status: next, note: next === "Blocked" ? (t.note ?? "") : "" } : t,
        ),
        activity: log(state, `${task.title} moved to ${next}`, action.now),
      };
    }

    case "add_expense":
      return {
        ...state,
        expenses: [{ id: tempId(action.now), categoryId: action.categoryId, amount: action.amount, note: action.note, spentOn: action.spentOn }, ...state.expenses].sort((a, b) => b.spentOn.localeCompare(a.spentOn)),
        budget: state.budget.map((b) => b.id === action.categoryId ? { ...b, spent: b.spent + action.amount } : b),
        activity: log(state, "Expense added", action.now),
      };

    case "add_issue":
      return {
        ...state,
        issues: [
          { id: tempId(action.now), title: action.title, severity: action.severity, status: "Open" },
          ...state.issues,
        ],
        activity: log(state, `Issue logged: ${action.title}`, action.now),
      };

    case "resolve_issue": {
      const issue = state.issues.find((i) => i.id === action.id);
      if (!issue) return state;
      return {
        ...state,
        issues: state.issues.map((i) => (i.id === issue.id ? { ...i, status: "Resolved" } : i)),
        activity: log(state, `Issue resolved: ${issue.title}`, action.now),
      };
    }
  }
}

type Problem = { problem: string; hint: string };

type Store = {
  state: EventState;
  now: number; // refreshed every 30 seconds so countdowns and "overdue" stay current
  loadError: Problem | null; // set when the first load from the database fails
  saveError: string | null; // set when a change could not be saved
  saving: boolean; // true while a change is being saved
  retryLoad: () => void;
  dismissSaveError: () => void;
  addTask: (title: string, priority: Priority, due: string) => void;
  moveTask: (id: number) => void;
  addExpense: (categoryId: number, amount: number, note: string, spentOn: string) => void;
  addIssue: (title: string, severity: Severity) => void;
  resolveIssue: (id: number) => void;
  resetDemo: () => Promise<boolean>; // true when the reset worked
};

const StoreContext = createContext<Store | null>(null);

const NETWORK_PROBLEM: Problem = {
  problem: "Could not reach the server.",
  hint: "Check your internet connection and try again.",
};

export function EventStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY_STATE);
  const [now, setNow] = useState(0);
  const [loadError, setLoadError] = useState<Problem | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(0); // how many changes are still being saved
  const lastGood = useRef<EventData | null>(null); // the last data the database confirmed
  const version = useRef(0); // goes up on every change we make, so a slow refresh cannot undo it

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await getEventData();
      if (r.ok) {
        lastGood.current = r.data;
        dispatch({ type: "replace", data: r.data });
      } else setLoadError({ problem: r.problem, hint: r.hint });
    } catch {
      setLoadError(NETWORK_PROBLEM);
    }
  }, []);

  // Quietly picks up changes made by other people (for example a volunteer finishing a task).
  // It does nothing while one of our own changes is still being saved, and throws away an answer
  // that arrives after we changed something, so it can never overwrite newer work.
  const refresh = useCallback(async () => {
    if (pending.current !== 0) return;
    const started = version.current;
    try {
      const r = await getEventData();
      if (r.ok && pending.current === 0 && version.current === started) {
        lastGood.current = r.data;
        dispatch({ type: "replace", data: r.data });
      }
    } catch {
      // A failed background refresh is not worth interrupting anyone for.
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden && lastGood.current) void refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load, refresh]);

  // After a failed save: go back to what the database last confirmed, then try to refresh.
  const undoUnsaved = useCallback(async () => {
    if (pending.current !== 0) return;
    if (lastGood.current) dispatch({ type: "replace", data: lastGood.current });
    await load();
  }, [load]);

  // Saves one change. Only the LAST answer replaces the screen, so a slow earlier answer
  // can never overwrite a newer change.
  const persist = useCallback(
    async (call: () => Promise<ApiResult>): Promise<boolean> => {
      pending.current += 1;
      version.current += 1;
      setSaving(true);
      let ok = false;
      try {
        const r = await call();
        pending.current -= 1;
        if (r.ok) {
          ok = true;
          lastGood.current = r.data;
          if (pending.current === 0) dispatch({ type: "replace", data: r.data });
        } else {
          setSaveError(`${r.problem} ${r.hint}`);
          await undoUnsaved();
        }
      } catch {
        pending.current -= 1;
        setSaveError("That change could not be saved, so it was undone.");
        await undoUnsaved();
      }
      if (pending.current === 0) setSaving(false);
      return ok;
    },
    [undoUnsaved],
  );

  const store = useMemo<Store>(
    () => ({
      state,
      now,
      loadError,
      saveError,
      saving,
      retryLoad: () => void load(),
      dismissSaveError: () => setSaveError(null),

      addTask: (title, priority, due) => {
        dispatch({ type: "add_task", title, priority, due, now: Date.now() });
        void persist(() => addTaskApi({ data: { title, priority, due } }));
      },

      moveTask: (id) => {
        const task = state.tasks.find((t) => t.id === id);
        if (!task || id < 0) return; // still being saved
        const next = TASK_STAGES[TASK_STAGES.indexOf(task.status) + 1];
        if (!next) return;
        dispatch({ type: "move_task", id, now: Date.now() });
        void persist(() => setTaskStatusApi({ data: { id, status: next } }));
      },

      addExpense: (categoryId, amount, note, spentOn) => {
        dispatch({ type: "add_expense", categoryId, amount, note, spentOn, now: Date.now() });
        void persist(() => addExpenseApi({ data: { categoryId, amount, note, spentOn } }));
      },

      addIssue: (title, severity) => {
        dispatch({ type: "add_issue", title, severity, now: Date.now() });
        void persist(() => addIssueApi({ data: { title, severity } }));
      },

      resolveIssue: (id) => {
        if (id < 0) return; // still being saved
        dispatch({ type: "resolve_issue", id, now: Date.now() });
        void persist(() => resolveIssueApi({ data: { id } }));
      },

      resetDemo: () => persist(() => resetDemoDataApi()),
    }),
    [state, now, loadError, saveError, saving, load, persist],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useEventStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useEventStore must be used inside <EventStoreProvider>");
  return store;
}
