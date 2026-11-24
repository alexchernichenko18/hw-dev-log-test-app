import type { TraceStep } from "@/lib/agents/runtime";

export interface AgentMeta {
  trace: TraceStep[];
  steps: number;
  model: string;
  mock: boolean;
}

/** Agent failure as seen by the UI: a user-facing message plus whatever trace the agent produced. */
export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly trace: TraceStep[] = [],
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

export async function callAgent<T>(url: string, body: unknown): Promise<T & AgentMeta> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AgentRequestError("Network error — is the dev server running?");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.issues?.[0]?.message ?? data?.error?.message ?? "The agent failed";
    throw new AgentRequestError(message, data?.trace ?? []);
  }
  return data as T & AgentMeta;
}
