import type { NextRequest } from "next/server";
import { z } from "zod";
import { agentErrorResponse, agentMeta } from "@/lib/agents/http";
import { AUDIENCES, runStatusUpdateAgent } from "@/lib/agents/status-update";
import { parseJsonBody } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";

const bodySchema = z.object({
  taskId: z.number().int().positive(),
  audience: z.enum(AUDIENCES).default("team"),
  note: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await runStatusUpdateAgent(getTaskRepository(), body.data);
    return Response.json({ update: result.update, ...agentMeta(result) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
