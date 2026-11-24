import type { NextRequest } from "next/server";
import { parseJsonBody, parseTaskId, toErrorResponse } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";
import { taskUpdateSchema } from "@/lib/tasks/schema";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const id = parseTaskId((await ctx.params).id);
  if (!id.ok) return id.response;

  try {
    return Response.json({ task: getTaskRepository().getWithSubtasks(id.data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const id = parseTaskId((await ctx.params).id);
  if (!id.ok) return id.response;
  const body = await parseJsonBody(request, taskUpdateSchema);
  if (!body.ok) return body.response;

  try {
    return Response.json({ task: getTaskRepository().update(id.data, body.data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const id = parseTaskId((await ctx.params).id);
  if (!id.ok) return id.response;

  try {
    getTaskRepository().delete(id.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
