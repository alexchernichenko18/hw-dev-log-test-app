"use client";

import { DecomposePanel } from "@/components/agents/decompose-panel";
import { StatusUpdatePanel } from "@/components/agents/status-update-panel";
import { Separator } from "@/components/ui/separator";
import type { TaskAiSlotProps } from "@/components/tasks/task-detail-dialog";

/** AI actions shown inside the task detail dialog. */
export function TaskAiPanels({ task, onChanged }: TaskAiSlotProps) {
  const canDecompose = task.parentId === null && task.status !== "done";
  return (
    <div className="grid gap-5">
      {canDecompose ? (
        <>
          <DecomposePanel taskId={task.id} onCreated={onChanged} />
          <Separator />
        </>
      ) : null}
      <StatusUpdatePanel taskId={task.id} />
    </div>
  );
}
