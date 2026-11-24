import type { NextRequest } from "next/server";
import { parseJsonBody, toErrorResponse, validationError } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";
import { taskCreateSchema, taskListQuerySchema } from "@/lib/tasks/schema";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = taskListQuerySchema.safeParse({
    status: params.get("status") ?? undefined,
    sort: params.get("sort") ?? undefined,
    order: params.get("order") ?? undefined,
  });
  if (!query.success) return validationError(query.error);

  try {
    return Response.json({ tasks: getTaskRepository().list(query.data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, taskCreateSchema);
  if (!body.ok) return body.response;

  try {
    const task = getTaskRepository().create(body.data);
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
