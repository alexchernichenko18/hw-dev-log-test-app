import { z } from "zod";
import {
  DESCRIPTION_MAX,
  NOTES_MAX,
  SORT_ORDERS,
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  TITLE_MAX,
} from "@/lib/tasks/types";

export * from "@/lib/tasks/types";

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

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
