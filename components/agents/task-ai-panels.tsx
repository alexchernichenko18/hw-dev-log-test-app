"use client";

import { DecomposePanel } from "@/components/agents/decompose-panel";
import type { TaskAiSlotProps } from "@/components/tasks/task-detail-dialog";

/** AI actions shown inside the task detail dialog. */
export function TaskAiPanels({ task, onChanged }: TaskAiSlotProps) {
  const isSubtask = task.parentId !== null;
  return (
    <div className="grid gap-5">
      {!isSubtask && task.status !== "done" ? <DecomposePanel taskId={task.id} onCreated={onChanged} /> : null}
    </div>
  );
}
