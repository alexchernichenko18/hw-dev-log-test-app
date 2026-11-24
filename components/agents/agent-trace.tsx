"use client";

import { useState } from "react";
import { ChevronRight, CircleAlert, Flag, Wrench } from "lucide-react";
import type { TraceStep } from "@/lib/agents/runtime";
import { cn } from "@/lib/utils";

/** Collapsible "how the agent got here" — every tool call the agent made, in order. */
export function AgentTrace({ trace, defaultOpen = false }: { trace: TraceStep[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (trace.length === 0) return null;
  const turns = new Set(trace.map((t) => t.step)).size;

  return (
    <div className="rounded-lg border bg-muted/30 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        How the agent got here
        <span className="ml-auto text-xs">
          {trace.length} tool call{trace.length === 1 ? "" : "s"} · {turns} turn{turns === 1 ? "" : "s"}
        </span>
      </button>
      {open ? (
        <ol className="grid gap-2 border-t px-3 py-3">
          {trace.map((step, index) => {
            const final = step.tool.startsWith("finish_") || step.tool.startsWith("propose_") || step.tool.startsWith("ask_");
            const Icon = step.error ? CircleAlert : final ? Flag : Wrench;
            return (
              <li key={index} className="flex gap-2">
                <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs text-muted-foreground">{step.step}</span>
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", step.error ? "text-destructive" : "text-muted-foreground")} />
                <div className="min-w-0">
                  <p>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{step.tool}</code>{" "}
                    <span className="text-muted-foreground">{step.summary}</span>
                  </p>
                  {step.thought ? <p className="mt-0.5 text-xs italic text-muted-foreground">“{step.thought}”</p> : null}
                  {step.error ? <p className="mt-0.5 text-xs text-destructive">{step.error}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
