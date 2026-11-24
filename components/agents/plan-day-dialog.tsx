"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CalendarCheck, RotateCcw } from "lucide-react";
import { AgentBadge, AgentWorking } from "@/components/agents/agent-badge";
import { AgentTrace } from "@/components/agents/agent-trace";
import { PriorityBadge, StatusDot } from "@/components/tasks/task-badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AgentRequestError, callAgent, type AgentMeta } from "@/lib/agents/client";
import type { DayPlan } from "@/lib/agents/prioritize";
import type { TraceStep } from "@/lib/agents/runtime";
import type { Task } from "@/lib/tasks/types";

type TaskRef = Pick<Task, "id" | "title" | "status" | "priority">;
type PlanResponse = {
  systemWarnings: string[];
  plan: Omit<DayPlan, "focus" | "later"> & {
    focus: (DayPlan["focus"][number] & { task: TaskRef })[];
    later: (DayPlan["later"][number] & { task: TaskRef })[];
  };
} & AgentMeta;

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: PlanResponse }
  | { kind: "error"; message: string; trace: TraceStep[] };

const ACTION_LABELS: Record<DayPlan["focus"][number]["action"], string> = {
  finish: "Finish",
  continue: "Continue",
  unblock: "Unblock",
  start: "Start",
};

interface PlanDayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (id: number) => void;
}

export function PlanDayDialog({ open, onOpenChange, onOpenTask }: PlanDayDialogProps) {
  const [context, setContext] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    setState({ kind: "running" });
    try {
      const result = await callAgent<Pick<PlanResponse, "plan" | "systemWarnings">>("/api/agents/prioritize", {
        context: context.trim() || undefined,
      });
      setState({ kind: "done", result });
    } catch (error) {
      const failure = error instanceof AgentRequestError ? error : new AgentRequestError("The agent failed");
      setState({ kind: "error", message: failure.message, trace: failure.trace });
    }
  }

  function openTask(id: number) {
    onOpenChange(false);
    onOpenTask(id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-5 text-ai" />
            Plan my day
          </DialogTitle>
          <DialogDescription>
            The agent reviews open tasks — priority, age, status, notes and subtask progress — and proposes where to
            start, with its reasoning.
          </DialogDescription>
        </DialogHeader>

        {state.kind !== "done" ? (
          <div className="grid gap-2">
            <Label htmlFor="plan-context">Anything the agent should know? (optional)</Label>
            <Textarea
              id="plan-context"
              rows={2}
              maxLength={1000}
              value={context}
              placeholder="e.g. Only 3 focused hours today, on-call after lunch"
              onChange={(event) => setContext(event.target.value)}
              disabled={state.kind === "running"}
            />
            <div className="flex justify-end">
              <Button onClick={run} disabled={state.kind === "running"}>
                {state.kind === "running" ? "Planning…" : "Plan my day"}
              </Button>
            </div>
          </div>
        ) : null}

        {state.kind === "running" ? <AgentWorking label="Reviewing the board and reading candidate tasks…" /> : null}

        {state.kind === "error" ? (
          <div className="grid gap-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {state.message}
            </div>
            <AgentTrace trace={state.trace} defaultOpen />
          </div>
        ) : null}

        {state.kind === "done" ? (
          <PlanResult result={state.result} onOpenTask={openTask} onRerun={() => setState({ kind: "idle" })} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PlanResult({
  result,
  onOpenTask,
  onRerun,
}: {
  result: PlanResponse;
  onOpenTask: (id: number) => void;
  onRerun: () => void;
}) {
  const { plan } = result;
  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed">{plan.summary}</p>
        <AgentBadge meta={result} />
      </div>

      <section className="grid gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Focus today</h3>
        <ol className="grid gap-2">
          {plan.focus.map((item, index) => (
            <li key={item.taskId}>
              <button
                type="button"
                onClick={() => onOpenTask(item.taskId)}
                className="group flex w-full gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ai-soft text-xs font-semibold text-ai">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-foreground px-1.5 py-0.5 text-[11px] font-semibold uppercase text-background">
                      {ACTION_LABELS[item.action]}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">#{item.task.id}</span>
                    <span className="font-medium">{item.task.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <StatusDot status={item.task.status} />
                    <PriorityBadge priority={item.task.priority} />
                  </div>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ol>
      </section>

      {plan.later.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Can wait</h3>
          <ul className="grid gap-1">
            {plan.later.map((item) => (
              <li key={item.taskId}>
                <button
                  type="button"
                  onClick={() => onOpenTask(item.taskId)}
                  className="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                >
                  <span>
                    <span className="mr-2 font-mono text-xs text-muted-foreground">#{item.task.id}</span>
                    <span className="font-medium">{item.task.title}</span>
                  </span>
                  <span className="text-muted-foreground">{item.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.warnings.length > 0 ? (
        <section className="grid gap-1.5 rounded-lg border border-priority-medium/30 bg-priority-medium/5 p-3">
          {plan.warnings.map((warning, index) => (
            <p key={index} className="flex gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-priority-medium" />
              {warning}
            </p>
          ))}
        </section>
      ) : null}

      {result.systemWarnings.length > 0 ? (
        <section className="grid gap-1.5 rounded-lg border border-dashed p-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Not mentioned by the agent · flagged by DevLog
          </h3>
          {result.systemWarnings.map((warning, index) => (
            <p key={index} className="text-sm text-muted-foreground">
              {warning}
            </p>
          ))}
        </section>
      ) : null}

      <AgentTrace trace={result.trace} />

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRerun}>
          <RotateCcw />
          Plan again
        </Button>
      </div>
    </div>
  );
}
