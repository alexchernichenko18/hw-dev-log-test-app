"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PrioritySelect, StatusSelect } from "@/components/tasks/task-selects";
import { errorMessage, tasksApi } from "@/lib/api-client";
import { DESCRIPTION_MAX, TITLE_MAX, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: number) => void;
}

function TaskFormBody({ onOpenChange, onCreated }: Omit<TaskFormDialogProps, "open">) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError("Title is required");
      return;
    }
    setSaving(true);
    try {
      const task = await tasksApi.create({ title, description, status, priority });
      toast.success("Task created");
      onCreated(task.id);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New task</DialogTitle>
        <DialogDescription>Describe the work. You can break it down with AI afterwards.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="new-task-title">Title</Label>
        <Input
          id="new-task-title"
          autoFocus
          value={title}
          maxLength={TITLE_MAX}
          placeholder="e.g. Add rate limiting to the public API"
          aria-invalid={Boolean(titleError)}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleError(null);
          }}
        />
        {titleError ? <p className="text-xs text-destructive">{titleError}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="new-task-description">Description</Label>
        <Textarea
          id="new-task-description"
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={4}
          placeholder="Context, acceptance criteria, links…"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Status</Label>
          <StatusSelect value={status} onChange={setStatus} className="w-full" aria-label="Status" />
        </div>
        <div className="grid gap-1.5">
          <Label>Priority</Label>
          <PrioritySelect value={priority} onChange={setPriority} className="w-full" aria-label="Priority" />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TaskFormDialog({ open, onOpenChange, onCreated }: TaskFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <TaskFormBody onOpenChange={onOpenChange} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}
