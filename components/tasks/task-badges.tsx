import { cn } from "@/lib/utils";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/tasks/labels";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/types";

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  high: "text-priority-high bg-priority-high/10 border-priority-high/25",
  medium: "text-priority-medium bg-priority-medium/10 border-priority-medium/25",
  low: "text-priority-low bg-priority-low/10 border-priority-low/25",
};

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium uppercase tracking-wide",
        PRIORITY_CLASSES[priority],
        className,
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export const STATUS_DOT_CLASSES: Record<TaskStatus, string> = {
  todo: "border-2 border-status-todo bg-transparent",
  "in-progress": "border-2 border-status-progress bg-status-progress/40",
  done: "border-2 border-status-done bg-status-done",
};

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", STATUS_DOT_CLASSES[status], className)}
    />
  );
}

export function StatusLabel({ status }: { status: TaskStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}
