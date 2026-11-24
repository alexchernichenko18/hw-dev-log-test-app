import { Sparkles } from "lucide-react";
import type { AgentMeta } from "@/lib/agents/client";

export function AgentBadge({ meta }: { meta: Pick<AgentMeta, "model" | "mock" | "steps"> }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-medium text-ai"
      title={meta.mock ? "No OPENAI_API_KEY configured — deterministic mock agent" : `Model: ${meta.model}`}
    >
      <Sparkles className="size-3" />
      {meta.mock ? "Mock agent" : meta.model} · {meta.steps} step{meta.steps === 1 ? "" : "s"}
    </span>
  );
}

/** Small "AI is working" indicator with a rotating status line. */
export function AgentWorking({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-ai opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-ai" />
      </span>
      {label}
    </div>
  );
}
