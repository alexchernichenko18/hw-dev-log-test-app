"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/tasks/labels";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";
import { StatusDot } from "@/components/tasks/task-badges";

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "default";
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function StatusSelect({ value, onChange, size = "default", className, ...rest }: SelectProps<TaskStatus>) {
  return (
    <Select
      value={value}
      items={STATUS_LABELS}
      onValueChange={(next) => next && onChange(next as TaskStatus)}
    >
      <SelectTrigger size={size} className={className} {...rest}>
        <StatusDot status={value} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            <StatusDot status={status} />
            {STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PRIORITY_ORDER: TaskPriority[] = [...TASK_PRIORITIES].reverse();

export function PrioritySelect({ value, onChange, size = "default", className, ...rest }: SelectProps<TaskPriority>) {
  return (
    <Select
      value={value}
      items={PRIORITY_LABELS}
      onValueChange={(next) => next && onChange(next as TaskPriority)}
    >
      <SelectTrigger size={size} className={className} {...rest}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITY_ORDER.map((priority) => (
          <SelectItem key={priority} value={priority}>
            {PRIORITY_LABELS[priority]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
