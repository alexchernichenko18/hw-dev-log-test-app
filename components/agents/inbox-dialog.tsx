"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Inbox, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AgentBadge, AgentWorking } from "@/components/agents/agent-badge";
import { AgentTrace } from "@/components/agents/agent-trace";
import { PrioritySelect } from "@/components/tasks/task-selects";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentRequestError, callAgent, type AgentMeta } from "@/lib/agents/client";
import type { Triage, TriageItem } from "@/lib/agents/inbox-triage";
import type { TraceStep } from "@/lib/agents/runtime";
import { ApiError } from "@/lib/api-client";
import { PRIORITY_LABELS } from "@/lib/tasks/labels";
import { TITLE_MAX, type Task, type TaskPriority } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

const TEXT_MAX = 6000;

const EXAMPLE = `Backend sync — Nov 24

- Worker pods OOMKilled again last night, twice. Ops says it's now hitting prod customers in EU. Need someone on the memory leak today.
- Security finished reviewing the crypto changes for the auth migration, all approved. Load test on staging is next.
- Partner X asked for a sandbox API key with higher limits until the rate limiting ships.
- Maria: error tracking for mobile web is live, already caught 3 bugs.
- We should add an alert when checkout error rate goes above 2%.
- Lunch on Friday is at the new ramen place.`;

type ItemView = TriageItem & {
  weakMatch: boolean;
  task: (Pick<Task, "id" | "title" | "status" | "priority" | "parentId">) | null;
};
type Response = { triage: Omit<Triage, "items"> & { items: ItemView[] } } & AgentMeta;

interface Row extends ItemView {
  key: number;
  selected: boolean;
}

type State =
  | { kind: "input" }
  | { kind: "running" }
  | { kind: "review"; result: Response; rows: Row[] }
  | { kind: "error"; message: string; trace: TraceStep[] };

const ACTION_STYLES: Record<TriageItem["action"], { label: string; className: string }> = {
  create: { label: "New task", className: "bg-status-done/15 text-status-done" },
  update: { label: "Update", className: "bg-status-progress/15 text-status-progress" },
  skip: { label: "Skip", className: "bg-muted text-muted-foreground" },
};

interface InboxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}

export function InboxDialog({ open, onOpenChange, onApplied }: InboxDialogProps) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "input" });
  const [applying, setApplying] = useState(false);

  async function run() {
    setState({ kind: "running" });
    try {
      const result = await callAgent<Pick<Response, "triage">>("/api/agents/inbox", { text });
      const rows = result.triage.items.map((item, key) => ({
        ...item,
        key,
        // Skips and suspicious matches start unchecked: the user opts in, not out.
        selected: item.action !== "skip" && !item.weakMatch,
      }));
      setState({ kind: "review", result, rows });
    } catch (error) {
      const failure = error instanceof AgentRequestError ? error : new AgentRequestError("The agent failed");
      setState({ kind: "error", message: failure.message, trace: failure.trace });
    }
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setState((prev) =>
      prev.kind === "review" ? { ...prev, rows: prev.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : prev,
    );
  }

  async function apply(rows: Row[]) {
    const changes = rows
      .filter((r) => r.selected && r.action !== "skip")
      .map((r) =>
        r.action === "create"
          ? { action: "create" as const, title: r.title.trim(), description: r.description, priority: r.priority }
          : { action: "update" as const, taskId: r.taskId!, note: r.note ?? r.sourceQuote, priority: r.priority },
      );
    if (changes.length === 0) return;
    setApplying(true);
    try {
      const response = await fetch("/api/inbox/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const data = await response.json();
      if (!response.ok) throw new ApiError(data?.error?.message ?? "Could not apply changes", response.status);
      toast.success(`Created ${data.created}, updated ${data.updated}`);
      onApplied();
      setText("");
      setState({ kind: "input" });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply changes");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-5 text-ai" />
            AI inbox
          </DialogTitle>
          <DialogDescription>
            Paste meeting notes, a Slack thread or a bug report. The agent extracts action items, checks each one
            against the board and proposes new tasks or updates to existing ones. You choose what gets applied.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "input" || state.kind === "running" || state.kind === "error" ? (
          <div className="grid gap-2">
            <Textarea
              value={text}
              rows={9}
              maxLength={TEXT_MAX}
              disabled={state.kind === "running"}
              placeholder="Paste text here…"
              aria-label="Text to triage"
              onChange={(event) => setText(event.target.value)}
              className="font-mono text-[13px]"
            />
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setText(EXAMPLE)} disabled={state.kind === "running"}>
                Use example meeting notes
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {text.length}/{TEXT_MAX}
                </span>
                <Button onClick={run} disabled={!text.trim() || state.kind === "running"}>
                  {state.kind === "running" ? "Triaging…" : "Triage"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {state.kind === "running" ? <AgentWorking label="Extracting action items and searching the board…" /> : null}

        {state.kind === "error" ? (
          <div className="grid gap-2">
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {state.message}
            </p>
            <AgentTrace trace={state.trace} defaultOpen />
          </div>
        ) : null}

        {state.kind === "review" ? (
          <TriageReview
            result={state.result}
            rows={state.rows}
            applying={applying}
            onChange={updateRow}
            onApply={() => apply(state.rows)}
            onBack={() => setState({ kind: "input" })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TriageReview({
  result,
  rows,
  applying,
  onChange,
  onApply,
  onBack,
}: {
  result: Response;
  rows: Row[];
  applying: boolean;
  onChange: (key: number, patch: Partial<Row>) => void;
  onApply: () => void;
  onBack: () => void;
}) {
  const selected = rows.filter((r) => r.selected && r.action !== "skip").length;

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">{result.triage.summary}</p>
        <AgentBadge meta={result} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No action items found in this text.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <TriageRow key={row.key} row={row} onChange={(patch) => onChange(row.key, patch)} />
          ))}
        </ul>
      )}

      <AgentTrace trace={result.trace} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <RotateCcw />
          Edit text
        </Button>
        <Button disabled={selected === 0 || applying} onClick={onApply}>
          {applying ? "Applying…" : `Apply ${selected} change${selected === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

function TriageRow({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const skip = row.action === "skip";
  const style = ACTION_STYLES[row.action];

  return (
    <li className={cn("grid gap-2 rounded-lg border bg-card p-3", !row.selected && "opacity-60")}>
      <div className="flex items-start gap-2">
        <Checkbox
          className="mt-1"
          checked={row.selected && !skip}
          disabled={skip}
          onCheckedChange={(checked) => onChange({ selected: checked })}
          aria-label={`Apply "${row.title}"`}
        />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase", style.className)}>
              {style.label}
            </span>
            {row.task ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-sm">
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">#{row.task.id}</span>
                <span className="truncate font-medium">{row.task.title}</span>
                {row.task.parentId ? (
                  <span className="shrink-0 text-xs text-muted-foreground">(subtask of #{row.task.parentId})</span>
                ) : null}
              </span>
            ) : null}
          </div>

          {row.action === "create" ? (
            <Input
              value={row.title}
              maxLength={TITLE_MAX}
              aria-label="New task title"
              onChange={(event) => onChange({ title: event.target.value })}
              className="h-8"
            />
          ) : null}
          {row.action === "update" && row.note ? <p className="text-sm">{row.note}</p> : null}

          <p className="text-xs text-muted-foreground">
            <span className="italic">“{row.sourceQuote}”</span> — {row.reason}
          </p>

          {row.action === "update" ? (
            <button
              type="button"
              onClick={() =>
                onChange({ action: "create", taskId: null, task: null, description: row.sourceQuote, weakMatch: false, selected: true })
              }
              className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Wrong task? Create as a new task instead
            </button>
          ) : null}

          {row.weakMatch ? (
            <p className="flex items-center gap-1.5 text-xs text-priority-medium">
              <AlertTriangle className="size-3.5" />
              Weak match: this text shares no keywords with #{row.taskId}. Check before applying.
            </p>
          ) : null}
        </div>

        {!skip ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PrioritySelect
              size="sm"
              value={row.priority}
              onChange={(priority: TaskPriority) => onChange({ priority })}
              aria-label="Priority"
              className="w-24"
            />
            {row.action === "update" && row.task && row.task.priority !== row.priority ? (
              <span className="text-[11px] text-muted-foreground">
                was {PRIORITY_LABELS[row.task.priority].toLowerCase()}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
