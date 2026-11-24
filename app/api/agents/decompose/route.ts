import type { NextRequest } from "next/server";
import { z } from "zod";
import { answersSchema, runDecomposeAgent } from "@/lib/agents/decompose";
import { agentErrorResponse, agentMeta } from "@/lib/agents/http";
import { parseJsonBody } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";

const bodySchema = z.object({
  taskId: z.number().int().positive(),
  answers: answersSchema.optional(),
});

/**
 * Stateless: a clarification round ends the run; the client calls again with the answers.
 * Proposed subtasks are NOT saved here — the client posts the confirmed ones to /api/tasks/[id]/subtasks.
 */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await runDecomposeAgent(getTaskRepository(), body.data);
    return Response.json({ outcome: result.outcome, ...agentMeta(result) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
