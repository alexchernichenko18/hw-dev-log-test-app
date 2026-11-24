import { getDb } from "@/lib/db";
import { TaskRepository } from "@/lib/tasks/repository";

export function getTaskRepository(): TaskRepository {
  return new TaskRepository(getDb());
}
