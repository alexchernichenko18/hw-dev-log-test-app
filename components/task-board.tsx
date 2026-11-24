"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, Inbox, Plus } from "lucide-react";
import { toast } from "sonner";
import { PlanDayDialog } from "@/components/agents/plan-day-dialog";
import { EmptyState } from "@/components/empty-state";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskToolbar, type StatusFilter } from "@/components/tasks/task-toolbar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskList } from "@/hooks/use-task-list";
import { errorMessage, tasksApi } from "@/lib/api-client";
import {
  SORT_ORDERS,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  type SortOrder,
  type TaskSortField,
  type TaskStatus,
} from "@/lib/tasks/types";

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Filter, sort and the open task live in the URL so a view survives reloads and can be shared. */
function useBoardParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const status = pick<StatusFilter>(searchParams.get("status"), ["all", ...TASK_STATUSES], "all");
  const sort = pick<TaskSortField>(searchParams.get("sort"), TASK_SORT_FIELDS, "priority");
  const order = pick<SortOrder>(searchParams.get("order"), SORT_ORDERS, "desc");
  const taskParam = Number(searchParams.get("task"));
  const openTaskId = Number.isSafeInteger(taskParam) && taskParam > 0 ? taskParam : null;

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null) next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { status, sort, order, openTaskId, setParam };
}

const EMPTY_COPY: Record<StatusFilter, { title: string; description: string }> = {
  all: { title: "No tasks yet", description: "Create the first task, or paste meeting notes into the AI inbox." },
  todo: { title: "Nothing to do", description: "No tasks are waiting to be started." },
  "in-progress": { title: "Nothing in progress", description: "Pick a task from To do and get going." },
  done: { title: "Nothing done yet", description: "Finished tasks will show up here." },
};

export function TaskBoard() {
  const { status, sort, order, openTaskId, setParam } = useBoardParams();
  const setOpenTaskId = (id: number | null) => setParam("task", id === null ? null : String(id));
  const { tasks, loading, error, reload, patchLocal } = useTaskList({
    status: status === "all" ? undefined : status,
    sort,
    order,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  async function handleStatusChange(id: number, next: TaskStatus) {
    const previous = tasks.find((task) => task.id === id)?.status;
    patchLocal(id, { status: next });
    try {
      await tasksApi.update(id, { status: next });
      // The task may no longer match the active filter.
      if (status !== "all") reload();
    } catch (err) {
      if (previous) patchLocal(id, { status: previous });
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dev<span className="text-muted-foreground">Log</span>
          </h1>
          <p className="text-sm text-muted-foreground">Engineering task tracker with AI agents</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" onClick={() => setPlanOpen(true)}>
            <CalendarCheck className="text-ai" />
            Plan my day
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New task
          </Button>
        </div>
      </header>

      <TaskToolbar
        status={status}
        sort={sort}
        order={order}
        onStatusChange={(value) => setParam("status", value)}
        onSortChange={(value) => setParam("sort", value)}
        onOrderChange={(value) => setParam("order", value)}
      />

      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <span className="text-destructive">{error}</span>
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <ul className="grid gap-2" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-lg" />
          ))}
        </ul>
      ) : tasks.length === 0 && !error ? (
        <EmptyState
          icon={<Inbox className="size-8" />}
          title={EMPTY_COPY[status].title}
          description={EMPTY_COPY[status].description}
          action={
            status === "all" ? (
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus />
                New task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onOpen={setOpenTaskId} onStatusChange={handleStatusChange} />
          ))}
        </ul>
      )}

      <TaskFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          reload();
          setOpenTaskId(id);
        }}
      />
      <PlanDayDialog open={planOpen} onOpenChange={setPlanOpen} onOpenTask={setOpenTaskId} />
      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={reload} />
    </div>
  );
}
