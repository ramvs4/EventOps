// The rules for where a dragged card lands. Kept separate from the screen so they can be tested on their own.
import { TASK_STAGES, type Task, type TaskStatus } from "./event-data";

// The cards of one column, in the order they are shown.
export const columnOf = (tasks: Task[], status: TaskStatus) => tasks.filter((t) => t.status === status);

// Returns the task list with card `id` moved to `status` at `index`
// (counted among the OTHER cards of that column, 0 = top).
export function placeTask(tasks: Task[], id: number, status: TaskStatus, index: number, reason = ""): Task[] {
  const moving = tasks.find((t) => t.id === id);
  if (!moving) return tasks;
  const others = tasks.filter((t) => t.id !== id);
  const target = columnOf(others, status);
  const at = Math.max(0, Math.min(index, target.length));
  const blockedReason =
    status === "Blocked" ? reason.trim() || (moving.status === "Blocked" ? (moving.note ?? "") : "") : "";
  const updated: Task = { ...moving, status, note: blockedReason };

  const result: Task[] = [];
  for (const stage of TASK_STAGES) {
    result.push(
      ...(stage === status
        ? [...target.slice(0, at), updated, ...target.slice(at)]
        : columnOf(others, stage)),
    );
  }
  return result;
}

export type DropOver =
  | { kind: "card"; id: number; below: boolean } // dropped on another card (below = the dragged card is in its lower half)
  | { kind: "column"; status: TaskStatus }; // dropped on a column's empty space

export type DropTarget = { status: TaskStatus; index: number };

// Works out where a dragged card should land, or null when nothing would change.
export function computeDrop(tasks: Task[], activeId: number, over: DropOver): DropTarget | null {
  const active = tasks.find((t) => t.id === activeId);
  if (!active) return null;

  let status: TaskStatus;
  let index: number;
  if (over.kind === "column") {
    status = over.status;
    index = columnOf(tasks, status).filter((t) => t.id !== activeId).length; // end of the column
  } else {
    const overCard = tasks.find((t) => t.id === over.id);
    if (!overCard) return null;
    status = overCard.status;
    const overIndex = columnOf(tasks, status).findIndex((t) => t.id === over.id);
    // Same column: the card takes the place of the card it was dropped on.
    // Another column: it goes before that card, or after it when dropped on its lower half.
    index = status === active.status ? overIndex : overIndex + (over.below ? 1 : 0);
  }

  const current = columnOf(tasks, active.status).findIndex((t) => t.id === activeId);
  if (status === active.status && index === current) return null;
  return { status, index };
}
