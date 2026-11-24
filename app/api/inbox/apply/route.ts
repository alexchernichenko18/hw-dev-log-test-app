import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody, toErrorResponse } from "@/lib/http";
import { getDb } from "@/lib/db";
import { getTaskRepository } from "@/lib/tasks";
import { taskPrioritySchema } from "@/lib/tasks/schema";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/tasks/types";

const changeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(1).max(TITLE_MAX),
    description: z.string().max(DESCRIPTION_MAX).default(""),
    priority: taskPrioritySchema,
  }),
  z.object({
    action: z.literal("update"),
    taskId: z.number().int().positive(),
    note: z.string().trim().min(1).max(500),
    priority: taskPrioritySchema.optional(),
  }),
]);

const bodySchema = z.object({ changes: z.array(changeSchema).min(1).max(12) });

/** Applies the inbox changes the user confirmed — all or nothing. */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema);
  if (!body.ok) return body.response;

  const repo = getTaskRepository();
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    const result = getDb().transaction(() => {
      let created = 0;
      let updated = 0;
      for (const change of body.data.changes) {
        if (change.action === "create") {
          repo.create({ ...change, status: "todo", notes: "", parentId: null });
          created++;
        } else {
          repo.appendNote(change.taskId, `[${stamp}, from inbox] ${change.note}`);
          if (change.priority) repo.update(change.taskId, { priority: change.priority });
          updated++;
        }
      }
      return { created, updated };
    })();
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
