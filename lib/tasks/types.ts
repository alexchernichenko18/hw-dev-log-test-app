/** Domain types and constants. Free of zod so client components can import them cheaply. */

export const TASK_STATUSES = ["todo", "in-progress", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_SORT_FIELDS = ["priority", "createdAt"] as const;
export const SORT_ORDERS = ["asc", "desc"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5_000;
export const NOTES_MAX = 10_000;

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes: string;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A top-level task as shown in the list, with subtask progress. */
export interface TaskSummary extends Task {
  subtaskCount: number;
  subtaskDoneCount: number;
}

export interface TaskWithSubtasks extends Task {
  subtasks: Task[];
}
