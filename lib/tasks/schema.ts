import { z } from "zod";

export const TASK_STATUSES = ["todo", "in-progress", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_SORT_FIELDS = ["priority", "createdAt"] as const;
export const SORT_ORDERS = ["asc", "desc"] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5_000;
export const NOTES_MAX = 10_000;

const title = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(TITLE_MAX, `Title must be at most ${TITLE_MAX} characters`);
const description = z.string().trim().max(DESCRIPTION_MAX);
const notes = z.string().trim().max(NOTES_MAX);

export const taskCreateSchema = z.object({
  title,
  description: description.default(""),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("medium"),
  notes: notes.default(""),
  parentId: z.number().int().positive().nullable().default(null),
});

export const taskUpdateSchema = z
  .object({
    title,
    description,
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    notes,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export const subtaskDraftSchema = z.object({
  title,
  description: description.default(""),
  priority: taskPrioritySchema.default("medium"),
});

export const subtasksCreateSchema = z.object({
  subtasks: z.array(subtaskDraftSchema).min(1).max(20),
});

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  sort: z.enum(TASK_SORT_FIELDS).default("createdAt"),
  order: z.enum(SORT_ORDERS).default("desc"),
});

export type TaskCreateInput = z.input<typeof taskCreateSchema>;
export type TaskCreate = z.output<typeof taskCreateSchema>;
export type TaskUpdate = z.output<typeof taskUpdateSchema>;
export type SubtaskDraft = z.output<typeof subtaskDraftSchema>;
export type TaskListQuery = z.output<typeof taskListQuerySchema>;

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
