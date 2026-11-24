import { AgentError, type AgentErrorCode } from "@/lib/agents/runtime";
import { isMockMode } from "@/lib/agents/provider";
import { toErrorResponse } from "@/lib/http";

const STATUS_BY_CODE: Record<AgentErrorCode, number> = {
  model_unavailable: 503,
  step_limit: 502,
  invalid_output: 502,
};

/** Agent failures carry their trace, so the UI can show how far the agent got. */
export function agentErrorResponse(error: unknown): Response {
  if (error instanceof AgentError) {
    return Response.json(
      { error: { code: error.code, message: error.message }, trace: error.trace, mock: isMockMode() },
      { status: STATUS_BY_CODE[error.code] },
    );
  }
  return toErrorResponse(error);
}

export function agentMeta(result: { trace: unknown; steps: number; model: string }) {
  return { trace: result.trace, steps: result.steps, model: result.model, mock: isMockMode() };
}
