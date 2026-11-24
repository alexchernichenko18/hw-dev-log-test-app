import type { NextRequest } from "next/server";
import { z } from "zod";
import { agentErrorResponse, agentMeta } from "@/lib/agents/http";
import { runPrioritizeAgent } from "@/lib/agents/prioritize";
import { parseJsonBody } from "@/lib/http";
import { getTaskRepository } from "@/lib/tasks";

const bodySchema = z.object({ context: z.string().max(1000).optional() });

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema);
  if (!body.ok) return body.response;

  const repo = getTaskRepository();
  try {
    const result = await runPrioritizeAgent(repo, body.data);
    // Attach current task data so the UI doesn't need extra requests.
    const withTask = <T extends { taskId: number }>(item: T) => {
      const task = repo.getById(item.taskId);
      return { ...item, task: { id: task.id, title: task.title, status: task.status, priority: task.priority } };
    };
    return Response.json({
      plan: {
        ...result.plan,
        focus: result.plan.focus.map(withTask),
        later: result.plan.later.map(withTask),
      },
      ...agentMeta(result),
    });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
