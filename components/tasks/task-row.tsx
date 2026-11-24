"use client";

import { ListChecks } from "lucide-react";
import { PriorityBadge } from "@/components/tasks/task-badges";
import { StatusSelect } from "@/components/tasks/task-selects";
import { formatAge } from "@/lib/format";
import type { TaskStatus, TaskSummary } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

interface TaskRowProps {
  task: TaskSummary;
  onOpen: (id: number) => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
}

export function TaskRow({ task, onOpen, onStatusChange }: TaskRowProps) {
  const done = task.status === "done";

  return (
    <li className="group relative flex items-start gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className="text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        >
          <span className="mr-2 font-mono text-xs text-muted-foreground">#{task.id}</span>
          <span className={cn("font-medium", done && "text-muted-foreground line-through")}>
            {task.title}
          </span>
        </button>
        {task.description ? (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{task.description}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <PriorityBadge priority={task.priority} />
          <span title={new Date(task.createdAt).toLocaleString()}>Created {formatAge(task.createdAt)}</span>
          {task.subtaskCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3.5" />
              {task.subtaskDoneCount}/{task.subtaskCount}
            </span>
          ) : null}
        </div>
      </div>

      {/* Sits above the row-wide click target so status changes don't open the task. */}
      <div className="relative z-10 shrink-0">
        <StatusSelect
          size="sm"
          value={task.status}
          onChange={(status) => onStatusChange(task.id, status)}
          className="w-[8.5rem]"
          aria-label={`Status of task ${task.id}`}
        />
      </div>
    </li>
  );
}
