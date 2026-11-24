import { ageInDays } from "@/lib/format";
import type { TaskRepository } from "@/lib/tasks/repository";
import type { Task, TaskSummary } from "@/lib/tasks/types";

/** Compact view of a task for the model: enough to reason about, cheap in tokens. */
export interface TaskBrief {
  id: number;
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  ageDays: number;
  daysSinceUpdate: number;
  subtasks: { done: number; total: number };
  hasNotes: boolean;
}

export function toBrief(task: TaskSummary, now: Date): TaskBrief {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    ageDays: ageInDays(task.createdAt, now),
    daysSinceUpdate: ageInDays(task.updatedAt, now),
    subtasks: { done: task.subtaskDoneCount, total: task.subtaskCount },
    hasNotes: task.notes.trim().length > 0,
  };
}

/** Full detail of one task, including subtasks and notes. */
export function taskDetail(repo: TaskRepository, id: number, now: Date) {
  const task = repo.getWithSubtasks(id);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    notes: task.notes,
    parentId: task.parentId,
    ageDays: ageInDays(task.createdAt, now),
    daysSinceUpdate: ageInDays(task.updatedAt, now),
    subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status, priority: s.priority })),
  };
}

export const STALE_IN_PROGRESS_DAYS = 3;
export const OLD_TODO_DAYS = 14;
