"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DeleteTaskDialog } from "@/components/tasks/delete-task-dialog";
import { PriorityBadge } from "@/components/tasks/task-badges";
import { PrioritySelect, StatusSelect } from "@/components/tasks/task-selects";
import { errorMessage, tasksApi, type TaskFields } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import {
  DESCRIPTION_MAX,
  NOTES_MAX,
  TITLE_MAX,
  type TaskWithSubtasks,
} from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

export interface TaskAiSlotProps {
  task: TaskWithSubtasks;
  /** Re-fetch the task and the list after the AI changed something. */
  onChanged: () => void;
}

interface TaskDetailDialogProps {
  taskId: number | null;
  onClose: () => void;
  /** Called after any change so the list can refresh. */
  onChanged: () => void;
  /** AI actions rendered under the task form (decomposition, status update). */
  renderAi?: (props: TaskAiSlotProps) => ReactNode;
}

function toFields(task: TaskWithSubtasks): TaskFields {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    notes: task.notes,
  };
}

function changedFields(
  original: TaskFields,
  draft: TaskFields,
): Partial<TaskFields> {
  const changes: Partial<TaskFields> = {};
  for (const key of Object.keys(draft) as (keyof TaskFields)[]) {
    if (draft[key] !== original[key])
      Object.assign(changes, { [key]: draft[key] });
  }
  return changes;
}

function TaskDetailBody({
  taskId,
  onClose,
  onChanged,
  renderAi,
}: Omit<TaskDetailDialogProps, "taskId"> & { taskId: number }) {
  const [task, setTask] = useState<TaskWithSubtasks | null>(null);
  const [draft, setDraft] = useState<TaskFields | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const load = useCallback(async () => {
    try {
      const fresh = await tasksApi.get(taskId);
      setTask(fresh);
      setDraft(toFields(fresh));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    tasksApi
      .get(taskId)
      .then((fresh) => {
        if (cancelled) return;
        setTask(fresh);
        setDraft(toFields(fresh));
      })
      .catch((error) => !cancelled && setLoadError(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const refresh = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  if (loadError) {
    return (
      <div className="grid gap-3">
        <DialogTitle>Task #{taskId}</DialogTitle>
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (!task || !draft) {
    return (
      <div className="grid gap-3">
        <DialogTitle className="sr-only">Loading task</DialogTitle>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    );
  }

  const changes = changedFields(toFields(task), draft);
  const dirty = Object.keys(changes).length > 0;

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!draft?.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      await tasksApi.update(taskId, changes);
      toast.success("Saved");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await tasksApi.remove(taskId);
      toast.success("Task deleted");
      onChanged();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function toggleSubtask(id: number, done: boolean) {
    try {
      await tasksApi.update(id, { status: done ? "done" : "todo" });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function removeSubtask(id: number) {
    try {
      await tasksApi.remove(id);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    const title = newSubtask.trim();
    if (!title) return;
    try {
      await tasksApi.createSubtasks(taskId, [{ title }]);
      setNewSubtask("");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const update = <K extends keyof TaskFields>(key: K, value: TaskFields[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const isSubtask = task.parentId !== null;
  const doneCount = task.subtasks.filter((s) => s.status === "done").length;

  return (
    <div className="grid gap-5 lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)]">
      <DialogHeader>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">#{task.id}</span>
          {isSubtask ? <span>· subtask of #{task.parentId}</span> : null}
          <span>· created {formatDateTime(task.createdAt)}</span>
          {task.updatedAt !== task.createdAt ? (
            <span>· updated {formatDateTime(task.updatedAt)}</span>
          ) : null}
        </div>
        <DialogTitle className="sr-only">{task.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Edit the task, its subtasks and run AI actions.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid content-start gap-5 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          <form onSubmit={handleSave} className="grid gap-4">
            <Input
              aria-label="Title"
              value={draft.title}
              maxLength={TITLE_MAX}
              onChange={(event) => update("title", event.target.value)}
              className="h-auto border-transparent px-1 text-lg font-semibold md:text-lg shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
            />

            <div className="flex flex-wrap gap-3">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <StatusSelect
                  value={draft.status}
                  onChange={(v) => update("status", v)}
                  aria-label="Status"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">
                  Priority
                </Label>
                <PrioritySelect
                  value={draft.priority}
                  onChange={(v) => update("priority", v)}
                  aria-label="Priority"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={draft.description}
                maxLength={DESCRIPTION_MAX}
                rows={4}
                placeholder="Context, acceptance criteria, links…"
                onChange={(event) => update("description", event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-notes">Progress notes</Label>
              <Textarea
                id="task-notes"
                value={draft.notes}
                maxLength={NOTES_MAX}
                rows={3}
                placeholder="What you tried, what's blocking, what's next — the status update agent reads this."
                onChange={(event) => update("notes", event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                Delete
              </Button>
              <div className="flex gap-2">
                {dirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft(toFields(task))}
                  >
                    Discard
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={!dirty || saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </form>

          {!isSubtask ? (
            <>
              <Separator />
              <section className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Subtasks</h3>
                  {task.subtasks.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {doneCount}/{task.subtasks.length} done
                    </span>
                  ) : null}
                </div>
                {task.subtasks.length > 0 ? (
                  <ul className="grid gap-1">
                    {task.subtasks.map((subtask) => {
                      const done = subtask.status === "done";
                      return (
                        <li
                          key={subtask.id}
                          className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={done}
                            onCheckedChange={(checked) =>
                              toggleSubtask(subtask.id, checked)
                            }
                            aria-label={`Mark "${subtask.title}" as ${done ? "not done" : "done"}`}
                          />
                          <span
                            className={cn(
                              "flex-1 text-sm",
                              done && "text-muted-foreground line-through",
                            )}
                          >
                            {subtask.title}
                          </span>
                          <PriorityBadge
                            priority={subtask.priority}
                            className="opacity-70"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={`Delete subtask "${subtask.title}"`}
                            onClick={() => removeSubtask(subtask.id)}
                          >
                            <X />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <form onSubmit={addSubtask} className="flex gap-2">
                  <Input
                    value={newSubtask}
                    maxLength={TITLE_MAX}
                    placeholder="Add a subtask"
                    aria-label="New subtask title"
                    onChange={(event) => setNewSubtask(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="icon"
                    aria-label="Add subtask"
                    disabled={!newSubtask.trim()}
                  >
                    <Plus />
                  </Button>
                </form>
              </section>
            </>
          ) : null}
        </div>

        {renderAi ? (
          <aside
            className="grid content-start gap-5 rounded-xl border bg-muted/20 p-4 lg:min-h-0 lg:overflow-y-auto"
            aria-label="AI actions"
          >
            {renderAi({ task, onChanged: refresh })}
          </aside>
        ) : null}
      </div>

      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        taskTitle={task.title}
        subtaskCount={task.subtasks.length}
        onConfirm={handleDelete}
      />
    </div>
  );
}

export function TaskDetailDialog({
  taskId,
  onClose,
  onChanged,
  renderAi,
}: TaskDetailDialogProps) {
  return (
    <Dialog open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Mobile: the whole dialog scrolls. Desktop: fixed height, each column scrolls on its own. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl lg:h-[90vh] lg:max-w-6xl lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {taskId !== null ? (
          <TaskDetailBody
            key={taskId}
            taskId={taskId}
            onClose={onClose}
            onChanged={onChanged}
            renderAi={renderAi}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
