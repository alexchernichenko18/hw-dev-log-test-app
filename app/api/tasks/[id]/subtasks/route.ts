import type { NextRequest } from "next/server";
import { parseJsonBody, parseTaskId, toErrorResponse } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";
import { subtasksCreateSchema } from "@/lib/tasks/schema";

/** Bulk-creates subtasks — used when the user confirms the decomposition agent's proposal. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/subtasks">) {
  const id = parseTaskId((await ctx.params).id);
  if (!id.ok) return id.response;
  const body = await parseJsonBody(request, subtasksCreateSchema);
  if (!body.ok) return body.response;

  try {
    const subtasks = getTaskRepository().createSubtasks(id.data, body.data.subtasks);
    return Response.json({ subtasks }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
