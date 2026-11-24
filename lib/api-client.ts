import type {
  SortOrder,
  Task,
  TaskPriority,
  TaskSortField,
  TaskStatus,
  TaskSummary,
  TaskWithSubtasks,
} from "@/lib/tasks/types";

/** Thrown for any non-2xx response; `message` is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Network error — is the dev server running?", 0);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    const detail = error?.issues?.[0]?.message;
    throw new ApiError(detail ?? error?.message ?? "Request failed", response.status, error?.code);
  }
  return body as T;
}

export interface TaskListParams {
  status?: TaskStatus;
  sort: TaskSortField;
  order: SortOrder;
}

export interface TaskFields {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes: string;
}

export const tasksApi = {
  async list(params: TaskListParams): Promise<TaskSummary[]> {
    const search = new URLSearchParams({ sort: params.sort, order: params.order });
    if (params.status) search.set("status", params.status);
    const { tasks } = await request<{ tasks: TaskSummary[] }>(`/api/tasks?${search}`);
    return tasks;
  },

  async get(id: number): Promise<TaskWithSubtasks> {
    const { task } = await request<{ task: TaskWithSubtasks }>(`/api/tasks/${id}`);
    return task;
  },

  async create(fields: Partial<TaskFields> & { title: string; parentId?: number }): Promise<Task> {
    const { task } = await request<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(fields),
    });
    return task;
  },

  async update(id: number, changes: Partial<TaskFields>): Promise<Task> {
    const { task } = await request<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    return task;
  },

  async remove(id: number): Promise<void> {
    await request<void>(`/api/tasks/${id}`, { method: "DELETE" });
  },

  async createSubtasks(
    id: number,
    subtasks: { title: string; description?: string; priority?: TaskPriority }[],
  ): Promise<Task[]> {
    const result = await request<{ subtasks: Task[] }>(`/api/tasks/${id}/subtasks`, {
      method: "POST",
      body: JSON.stringify({ subtasks }),
    });
    return result.subtasks;
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
