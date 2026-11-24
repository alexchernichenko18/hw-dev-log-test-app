"use client";

import { useState } from "react";
import { HelpCircle, ListTree, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AgentBadge, AgentWorking } from "@/components/agents/agent-badge";
import { AgentTrace } from "@/components/agents/agent-trace";
import { PrioritySelect } from "@/components/tasks/task-selects";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AgentRequestError, callAgent, type AgentMeta } from "@/lib/agents/client";
import type { Clarification, ClarificationAnswer, DecomposeOutcome, Proposal } from "@/lib/agents/decompose";
import type { TraceStep } from "@/lib/agents/runtime";
import { errorMessage, tasksApi } from "@/lib/api-client";
import { TITLE_MAX, type TaskPriority } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

type Response = { outcome: DecomposeOutcome } & AgentMeta;

interface Draft {
  key: number;
  selected: boolean;
  title: string;
  description: string;
  priority: TaskPriority;
}

type State =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "clarify"; clarification: Clarification; meta: AgentMeta }
  | { kind: "proposal"; proposal: Proposal; drafts: Draft[]; meta: AgentMeta }
  | { kind: "error"; message: string; trace: TraceStep[] };

interface DecomposePanelProps {
  taskId: number;
  onCreated: () => void;
}

export function DecomposePanel({ taskId, onCreated }: DecomposePanelProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [answers, setAnswers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  async function run(withAnswers?: ClarificationAnswer[]) {
    setState({
      kind: "running",
      label: withAnswers ? "Using your answers to plan the subtasks…" : "Reading the task and looking for related work…",
    });
    try {
      const result = await callAgent<Pick<Response, "outcome">>("/api/agents/decompose", {
        taskId,
        answers: withAnswers,
      });
      if (result.outcome.kind === "clarify") {
        setAnswers(result.outcome.clarification.questions.map(() => ""));
        setState({ kind: "clarify", clarification: result.outcome.clarification, meta: result });
      } else {
        const drafts = result.outcome.proposal.subtasks.map((s, key) => ({ ...s, key, selected: true }));
        setState({ kind: "proposal", proposal: result.outcome.proposal, drafts, meta: result });
      }
    } catch (error) {
      const failure = error instanceof AgentRequestError ? error : new AgentRequestError("The agent failed");
      setState({ kind: "error", message: failure.message, trace: failure.trace });
    }
  }

  function submitAnswers(clarification: Clarification) {
    const filled = clarification.questions
      .map((q, i) => ({ question: q.question, answer: answers[i]?.trim() ?? "" }))
      .filter((a) => a.answer.length > 0);
    if (filled.length === 0) {
      toast.error("Answer at least one question, or skip to let the agent assume");
      return;
    }
    void run(filled);
  }

  function updateDraft(key: number, patch: Partial<Draft>) {
    setState((prev) =>
      prev.kind === "proposal"
        ? { ...prev, drafts: prev.drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)) }
        : prev,
    );
  }

  async function createSelected(drafts: Draft[]) {
    const chosen = drafts
      .filter((d) => d.selected && d.title.trim())
      .map(({ title, description, priority }) => ({ title: title.trim(), description, priority }));
    if (chosen.length === 0) return;
    setCreating(true);
    try {
      await tasksApi.createSubtasks(taskId, chosen);
      toast.success(`Created ${chosen.length} subtask${chosen.length === 1 ? "" : "s"}`);
      setState({ kind: "idle" });
      onCreated();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ListTree className="size-4 text-ai" />
          Break down with AI
        </h3>
        {state.kind === "idle" ? (
          <Button variant="outline" size="sm" onClick={() => run()}>
            Suggest subtasks
          </Button>
        ) : null}
      </div>

      {state.kind === "idle" ? (
        <p className="text-sm text-muted-foreground">
          The agent reads the task, checks the board for related work and either asks what&apos;s unclear or proposes
          subtasks. Nothing is created until you confirm.
        </p>
      ) : null}

      {state.kind === "running" ? <AgentWorking label={state.label} /> : null}

      {state.kind === "error" ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="text-destructive">{state.message}</span>
            <Button variant="outline" size="sm" onClick={() => run()}>
              Retry
            </Button>
          </div>
          <AgentTrace trace={state.trace} />
        </div>
      ) : null}

      {state.kind === "clarify" ? (
        <div className="grid gap-3 rounded-lg border border-ai/30 bg-ai-soft/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="flex gap-2 text-sm">
              <HelpCircle className="mt-0.5 size-4 shrink-0 text-ai" />
              <span>
                <span className="font-medium">Before splitting this up: </span>
                {state.clarification.reason}
              </span>
            </p>
            <AgentBadge meta={state.meta} />
          </div>
          {state.clarification.questions.map((question, index) => (
            <div key={index} className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor={`clarify-${index}`}>
                {question.question}
              </label>
              {question.options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAnswers((prev) => prev.map((a, i) => (i === index ? option : a)))}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-muted",
                        answers[index] === option && "border-ai bg-ai-soft text-ai",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
              <Input
                id={`clarify-${index}`}
                value={answers[index] ?? ""}
                maxLength={500}
                placeholder="Your answer"
                onChange={(event) =>
                  setAnswers((prev) => prev.map((a, i) => (i === index ? event.target.value : a)))
                }
              />
            </div>
          ))}
          <AgentTrace trace={state.meta.trace} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setState({ kind: "idle" })}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => submitAnswers(state.clarification)}>
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {state.kind === "proposal" ? (
        <ProposalReview
          proposal={state.proposal}
          drafts={state.drafts}
          meta={state.meta}
          creating={creating}
          onChange={updateDraft}
          onCreate={() => createSelected(state.drafts)}
          onDiscard={() => setState({ kind: "idle" })}
          onRetry={() => run()}
        />
      ) : null}
    </section>
  );
}

function ProposalReview({
  proposal,
  drafts,
  meta,
  creating,
  onChange,
  onCreate,
  onDiscard,
  onRetry,
}: {
  proposal: Proposal;
  drafts: Draft[];
  meta: AgentMeta;
  creating: boolean;
  onChange: (key: number, patch: Partial<Draft>) => void;
  onCreate: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const selectedCount = drafts.filter((d) => d.selected && d.title.trim()).length;
  return (
    <div className="grid gap-3 rounded-lg border border-ai/30 bg-ai-soft/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">{proposal.approach}</p>
        <AgentBadge meta={meta} />
      </div>

      <ul className="grid gap-1.5">
        {drafts.map((draft) => (
          <li key={draft.key} className={cn("flex items-start gap-2 rounded-md bg-background p-2", !draft.selected && "opacity-50")}>
            <Checkbox
              className="mt-2"
              checked={draft.selected}
              onCheckedChange={(checked) => onChange(draft.key, { selected: checked })}
              aria-label={`Include "${draft.title}"`}
            />
            <div className="grid min-w-0 flex-1 gap-1">
              <Input
                value={draft.title}
                maxLength={TITLE_MAX}
                aria-label="Subtask title"
                onChange={(event) => onChange(draft.key, { title: event.target.value })}
                className="h-8"
              />
              {draft.description ? <p className="px-1 text-xs text-muted-foreground">{draft.description}</p> : null}
            </div>
            <PrioritySelect
              size="sm"
              value={draft.priority}
              onChange={(priority) => onChange(draft.key, { priority })}
              aria-label="Subtask priority"
              className="mt-0.5 w-24"
            />
          </li>
        ))}
      </ul>

      {proposal.assumptions.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <p className="font-medium">Assumptions</p>
          <ul className="list-disc pl-4">
            {proposal.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <AgentTrace trace={meta.trace} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCcw />
          Try again
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" disabled={selectedCount === 0 || creating} onClick={onCreate}>
            {creating ? "Creating…" : `Create ${selectedCount} subtask${selectedCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
