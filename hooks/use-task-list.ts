"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage, tasksApi, type TaskListParams } from "@/lib/api-client";
import type { TaskSummary } from "@/lib/tasks/types";

interface TaskListState {
  tasks: TaskSummary[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads the task list for the given filter/sort and exposes `reload`.
 * Kept deliberately small instead of pulling in a data-fetching library:
 * one list, one user, no cache sharing needed.
 */
export function useTaskList(params: TaskListParams) {
  const { status, sort, order } = params;
  const [state, setState] = useState<TaskListState>({ tasks: [], loading: true, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    tasksApi
      .list({ status, sort, order })
      .then((tasks) => {
        if (!cancelled) setState({ tasks, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: errorMessage(error) }));
      });
    return () => {
      cancelled = true;
    };
  }, [status, sort, order, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Optimistically patch one task in the list (e.g. status change) before the server confirms. */
  const patchLocal = useCallback((id: number, patch: Partial<TaskSummary>) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    }));
  }, []);

  return { ...state, reload, patchLocal };
}
