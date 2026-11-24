"use client";

import { useState } from "react";
import { Check, Copy, MessageSquareText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AgentBadge, AgentWorking } from "@/components/agents/agent-badge";
import { AgentTrace } from "@/components/agents/agent-trace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AgentRequestError, callAgent, type AgentMeta } from "@/lib/agents/client";
import type { TraceStep } from "@/lib/agents/runtime";
import type { Audience, StatusUpdate, Tone } from "@/lib/agents/status-update";
import { cn } from "@/lib/utils";

const AUDIENCE_LABELS: Record<Audience, string> = {
  team: "Team",
  manager: "Manager",
  stakeholders: "Stakeholders",
};

const TONE_STYLES: Record<Tone, { label: string; className: string }> = {
  shipped: { label: "Shipped", className: "bg-status-done/15 text-status-done" },
  "on-track": { label: "On track", className: "bg-status-progress/15 text-status-progress" },
  "heads-up": { label: "Heads-up", className: "bg-priority-medium/15 text-priority-medium" },
  blocked: { label: "Blocked", className: "bg-priority-high/15 text-priority-high" },
};

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; update: StatusUpdate; meta: AgentMeta; draft: string }
  | { kind: "error"; message: string; trace: TraceStep[] };

export function StatusUpdatePanel({ taskId }: { taskId: number }) {
  const [audience, setAudience] = useState<Audience>("team");
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function run() {
    setState({ kind: "running" });
    try {
      const result = await callAgent<{ update: StatusUpdate }>("/api/agents/status-update", {
        taskId,
        audience,
        note: note.trim() || undefined,
      });
      setState({ kind: "done", update: result.update, meta: result, draft: result.update.message });
    } catch (error) {
      const failure = error instanceof AgentRequestError ? error : new AgentRequestError("The agent failed");
      setState({ kind: "error", message: failure.message, trace: failure.trace });
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't access the clipboard — select the text and copy it manually");
    }
  }

  const running = state.kind === "running";

  return (
    <section className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <MessageSquareText className="size-4 text-ai" />
        Status update for Slack
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={audience} onValueChange={(value) => setAudience(value as Audience)}>
          <TabsList>
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((value) => (
              <TabsTrigger key={value} value={value} disabled={running}>
                {AUDIENCE_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          value={note}
          maxLength={500}
          disabled={running}
          placeholder="What's new? (optional)"
          aria-label="Extra note for the update"
          onChange={(event) => setNote(event.target.value)}
          className="h-8 min-w-48 flex-1"
        />
        <Button variant="outline" size="sm" onClick={run} disabled={running}>
          {state.kind === "done" ? <RotateCcw /> : null}
          {state.kind === "done" ? "Regenerate" : "Write update"}
        </Button>
      </div>

      {running ? <AgentWorking label="Reading the task, notes and subtasks…" /> : null}

      {state.kind === "error" ? (
        <div className="grid gap-2">
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {state.message}
          </p>
          <AgentTrace trace={state.trace} />
        </div>
      ) : null}

      {state.kind === "done" ? (
        <div className="grid gap-2 rounded-lg border border-ai/30 bg-ai-soft/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                TONE_STYLES[state.update.tone].className,
              )}
              title="Tone chosen by the agent from the task's facts"
            >
              {TONE_STYLES[state.update.tone].label}
            </span>
            <AgentBadge meta={state.meta} />
          </div>
          <Textarea
            value={state.draft}
            rows={Math.min(10, state.draft.split("\n").length + 1)}
            aria-label="Status update text — edit before copying"
            onChange={(event) =>
              setState((prev) => (prev.kind === "done" ? { ...prev, draft: event.target.value } : prev))
            }
            className="bg-background font-mono text-[13px]"
          />
          {state.update.askForHelp ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Ask:</span> {state.update.askForHelp}
            </p>
          ) : null}
          <AgentTrace trace={state.meta.trace} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => copy(state.draft)}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy for Slack"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
