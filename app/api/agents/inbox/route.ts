import type { NextRequest } from "next/server";
import { z } from "zod";
import { agentErrorResponse, agentMeta } from "@/lib/agents/http";
import { INBOX_TEXT_MAX, runInboxTriageAgent, sharedTerms } from "@/lib/agents/inbox-triage";
import { parseJsonBody } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";

const bodySchema = z.object({ text: z.string().trim().min(1, "Paste some text first").max(INBOX_TEXT_MAX) });

/** Proposes changes only. The user applies the selected ones via POST /api/inbox/apply. */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema);
  if (!body.ok) return body.response;

  const repo = getTaskRepository();
  try {
    const result = await runInboxTriageAgent(repo, body.data.text);
    const items = result.triage.items.map((item) => {
      const task = item.taskId !== null ? repo.findById(item.taskId) : null;
      const weakMatch = item.action === "update" && task !== null && sharedTerms(repo, item, task.id).length === 0;
      return {
        ...item,
        weakMatch,
        task: task && { id: task.id, title: task.title, status: task.status, priority: task.priority, parentId: task.parentId },
      };
    });
    return Response.json({ triage: { ...result.triage, items }, ...agentMeta(result) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
