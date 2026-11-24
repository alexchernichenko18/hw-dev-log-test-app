import type { z } from "zod";
import { InvalidParentError, TaskNotFoundError } from "@/lib/tasks/repository";

export type ApiErrorCode =
  | "invalid_json"
  | "validation_failed"
  | "invalid_id"
  | "not_found"
  | "invalid_parent"
  | "internal";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: { path: string; message: string }[];
  };
}

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  issues?: ApiErrorBody["error"]["issues"],
): Response {
  const body: ApiErrorBody = { error: { code, message, ...(issues ? { issues } : {}) } };
  return Response.json(body, { status });
}

export function validationError(error: z.ZodError): Response {
  return jsonError(
    400,
    "validation_failed",
    "Request validation failed",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParseResult<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "Body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: validationError(parsed.error) };
  return { ok: true, data: parsed.data };
}

export function parseTaskId(value: string): ParseResult<number> {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, response: jsonError(400, "invalid_id", "Task id must be a positive integer") };
  }
  return { ok: true, data: id };
}

/** Maps domain errors to HTTP responses; anything unknown is a 500. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof TaskNotFoundError) {
    return jsonError(404, "not_found", error.message);
  }
  if (error instanceof InvalidParentError) {
    return jsonError(422, "invalid_parent", error.message);
  }
  console.error(error);
  return jsonError(500, "internal", "Unexpected server error");
}
