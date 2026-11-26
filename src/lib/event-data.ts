// The shape of all event data. The data itself lives in the database (see db/seed.sql).

export type TaskStatus = "Backlog" | "In Progress" | "Blocked" | "Done";
export const TASK_STAGES: TaskStatus[] = ["Backlog", "In Progress", "Blocked", "Done"];

export type Priority = "High" | "Medium" | "Low";
export type Task = {
  id: number;
  title: string;
  owner: string;
  due: string; // "YYYY-MM-DD", or "" when no date
  priority: Priority;
  status: TaskStatus;
  note?: string; // the volunteer's reason while a task is Blocked
};

export type ResourceStatus = "Booked" | "Pending" | "Conflict" | "Free";
export type Resource = {
  id: number;
  name: string;
  kind: "venue" | "gear";
  slot: string;
  status: ResourceStatus;
};

export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Issue = { id: number; title: string; severity: Severity; status: "Open" | "Resolved" };

export type BudgetLine = { id: number; head: string; spent: number; total: number };
export type Expense = { id: number; categoryId: number; amount: number; note: string; spentOn: string };
export type Sponsor = { id: number; name: string; amount: number; status: "Paid" | "Pending"; note: string };
export type ScheduleItem = { id: number; title: string; venue: string; at: number };
export type ActivityItem = { id: number; text: string; at: number };

// What the server sends to the browser.
export type EventData = {
  eventName: string;
  eventStart: number;
  tasks: Task[];
  resources: Resource[];
  issues: Issue[];
  resolvedEarlier: number; // issues already resolved before this session
  budget: BudgetLine[];
  expenses: Expense[];
  sponsors: Sponsor[];
  schedule: ScheduleItem[];
  activity: ActivityItem[];
};

// What the pages read: the server data plus "has it arrived yet?".
export type EventState = EventData & { ready: boolean };

export const EMPTY_STATE: EventState = {
  ready: false,
  eventName: "",
  eventStart: 0,
  tasks: [],
  resources: [],
  issues: [],
  resolvedEarlier: 0,
  budget: [],
  expenses: [],
  sponsors: [],
  schedule: [],
  activity: [],
};
