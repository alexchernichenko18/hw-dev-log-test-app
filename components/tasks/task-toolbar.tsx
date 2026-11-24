"use client";

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_LABELS } from "@/lib/tasks/labels";
import { TASK_STATUSES, type SortOrder, type TaskSortField, type TaskStatus } from "@/lib/tasks/types";

export type StatusFilter = TaskStatus | "all";

const SORT_LABELS: Record<TaskSortField, string> = {
  priority: "Priority",
  createdAt: "Created",
};

interface TaskToolbarProps {
  status: StatusFilter;
  sort: TaskSortField;
  order: SortOrder;
  onStatusChange: (status: StatusFilter) => void;
  onSortChange: (sort: TaskSortField) => void;
  onOrderChange: (order: SortOrder) => void;
}

export function TaskToolbar({ status, sort, order, onStatusChange, onSortChange, onOrderChange }: TaskToolbarProps) {
  const descending = order === "desc";
  const orderHint =
    sort === "priority"
      ? descending ? "High → low" : "Low → high"
      : descending ? "Newest first" : "Oldest first";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs value={status} onValueChange={(value) => onStatusChange(value as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {TASK_STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {STATUS_LABELS[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select
          value={sort}
          items={SORT_LABELS}
          onValueChange={(value) => value && onSortChange(value as TaskSortField)}
        >
          <SelectTrigger size="sm" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="createdAt">Created</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOrderChange(descending ? "asc" : "desc")}
          aria-label={`Sort order: ${orderHint}. Click to reverse.`}
          title="Reverse order"
        >
          {descending ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
          {orderHint}
        </Button>
      </div>
    </div>
  );
}
