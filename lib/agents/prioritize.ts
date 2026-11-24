import { z } from "zod";
import { createModel } from "@/lib/agents/provider";
import { defineFinishTool, defineTool, runAgent } from "@/lib/agents/runtime";
import type { ScriptPolicy } from "@/lib/agents/scripted-model";
import {
  OLD_TODO_DAYS,
  STALE_IN_PROGRESS_DAYS,
  taskDetail,
  toBrief,
  type TaskBrief,
} from "@/lib/agents/task-context";
import type { TaskRepository } from "@/lib/tasks/repository";
import { taskStatusSchema } from "@/lib/tasks/schema";

export const FOCUS_ACTIONS = ["finish", "continue", "unblock", "start"] as const;

export const dayPlanSchema = z.object({
  summary: z.string().min(1).max(600).describe("2-3 sentences: the logic of today's plan."),
  focus: z
    .array(
      z.object({
        taskId: z.number().int(),
        action: z.enum(FOCUS_ACTIONS).describe("What to do with the task today."),
        reason: z.string().min(1).max(400).describe("Why this task, why now — cite priority, age, status, progress."),
      }),
    )
    .min(1)
    .max(3)
    .describe("Ordered: what to work on first. At most 3 — a day has limited focus."),
  later: z
    .array(z.object({ taskId: z.number().int(), reason: z.string().min(1).max(300) }))
    .max(5)
    .describe("Tasks consciously postponed, with why they can wait."),
  warnings: z
    .array(z.string().max(300))
    .max(4)
    .describe("Risks worth flagging: stale in-progress work, too much WIP, old high-priority tasks, vague tasks."),
});

export type DayPlan = z.infer<typeof dayPlanSchema>;

const SYSTEM_PROMPT = `You are the planning agent of DevLog, a task tracker for an engineering team.
Your job: recommend what the user should work on today and explain the logic.

Work in steps:
1. Call get_board_overview to see the whole board and its warning signals.
2. Call get_task for the candidates you are seriously considering (at least 2) — descriptions, notes and subtasks often change the picture (e.g. a task is blocked, or one subtask away from done).
3. Call finish_plan.

How to decide:
- Prefer finishing over starting: in-progress work that is close to done or blocking others comes first. Limit work in progress.
- High priority matters, but is not everything: a medium task stuck in progress for a week can be more urgent than a fresh high one.
- Age matters: old tasks are either forgotten (flag them) or not important (say so). Do not ignore them silently.
- If a task is blocked by someone else (see notes), the action is "unblock" — e.g. ping the reviewer — not "continue".
- Vague tasks (no clear outcome) should not be in focus; flag them in warnings and suggest decomposing them.
- Never include done tasks. Only use task ids you have seen in tool results.
- Respect the user's context (available time, meetings) if given.
Be concrete and brief. Reasons must reference facts from the tools (priority, days, status, notes), not generic advice.`;

export interface PrioritizeInput {
  context?: string;
}

export async function runPrioritizeAgent(repo: TaskRepository, input: PrioritizeInput, now: Date = new Date()) {
  const openTasks = () =>
    repo.list({ sort: "priority", order: "desc" }).filter((task) => task.status !== "done");

  const getBoardOverview = defineTool({
    name: "get_board_overview",
    description:
      "All open (not done) top-level tasks as compact briefs, plus counts and warning signals (stale in-progress, old todo, high priority not started).",
    input: z.object({}),
    run: () => {
      const all = repo.list({ sort: "priority", order: "desc" });
      const briefs = all.filter((t) => t.status !== "done").map((t) => toBrief(t, now));
      return {
        today: now.toISOString().slice(0, 10),
        counts: {
          todo: all.filter((t) => t.status === "todo").length,
          inProgress: all.filter((t) => t.status === "in-progress").length,
          done: all.filter((t) => t.status === "done").length,
        },
        signals: {
          staleInProgress: briefs
            .filter((t) => t.status === "in-progress" && t.daysSinceUpdate >= STALE_IN_PROGRESS_DAYS)
            .map((t) => t.id),
          oldTodo: briefs.filter((t) => t.status === "todo" && t.ageDays >= OLD_TODO_DAYS).map((t) => t.id),
          highPriorityNotStarted: briefs.filter((t) => t.status === "todo" && t.priority === "high").map((t) => t.id),
        },
        tasks: briefs,
      };
    },
    summarize: (_input, output) => {
      const count = (output as { tasks: unknown[] }).tasks.length;
      return `Reviewed the board: ${count} open task${count === 1 ? "" : "s"}`;
    },
  });

  const listTasks = defineTool({
    name: "list_tasks",
    description: "Top-level tasks filtered by status, as compact briefs.",
    input: z.object({ status: taskStatusSchema }),
    run: ({ status }) =>
      repo.list({ status, sort: "priority", order: "desc" }).map((t) => toBrief(t, now)),
    summarize: ({ status }, output) => `Listed ${(output as unknown[]).length} "${status}" tasks`,
  });

  const getTask = defineTool({
    name: "get_task",
    description: "Full details of one task: description, progress notes and subtasks.",
    input: z.object({ id: z.number().int().positive() }),
    run: ({ id }) => taskDetail(repo, id, now),
    summarize: ({ id }, output) => `Read task #${id} “${(output as { title: string }).title}”`,
  });

  const finishPlan = defineFinishTool({
    name: "finish_plan",
    description: "Return the day plan. Ends the run.",
    output: dayPlanSchema,
    check: (plan) => {
      const open = new Map(openTasks().map((t) => [t.id, t]));
      const problems: string[] = [];
      const seen = new Set<number>();
      for (const { taskId } of [...plan.focus, ...plan.later]) {
        if (!open.has(taskId)) problems.push(`task ${taskId} is not an open top-level task`);
        if (seen.has(taskId)) problems.push(`task ${taskId} appears more than once`);
        seen.add(taskId);
      }
      return problems;
    },
  });

  const userMessage = [
    `Plan my day. Today is ${now.toISOString().slice(0, 10)}.`,
    input.context?.trim() ? `My context: ${input.context.trim()}` : "No extra context from me.",
  ].join("\n");

  const result = await runAgent({
    name: "prioritize",
    system: SYSTEM_PROMPT,
    input: userMessage,
    tools: [getBoardOverview, listTasks, getTask],
    finishTools: { finish_plan: finishPlan },
    model: createModel(mockPolicy),
    maxSteps: 8,
  });

  return { ...result, plan: result.finish.output as DayPlan };
}

// ---------------------------------------------------------------------------
// Mock policy — used when no OPENAI_API_KEY is configured.
// A transparent scoring heuristic driving the same tools and output contract.
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT = { high: 30, medium: 18, low: 6 } as const;

export function scoreTask(task: TaskBrief): number {
  let score = PRIORITY_WEIGHT[task.priority];
  if (task.status === "in-progress") score += 15;
  if (task.subtasks.total > 0) score += (task.subtasks.done / task.subtasks.total) * 10;
  score += Math.min(task.ageDays, 20) * 0.5;
  return score;
}

function mockReason(task: TaskBrief): { action: (typeof FOCUS_ACTIONS)[number]; reason: string } {
  const progress = task.subtasks.total > 0 ? `, ${task.subtasks.done}/${task.subtasks.total} subtasks done` : "";
  if (task.status === "in-progress") {
    const almost = task.subtasks.total > 0 && task.subtasks.done / task.subtasks.total >= 0.6;
    return {
      action: almost ? "finish" : "continue",
      reason: `${task.priority} priority, already in progress for ${task.ageDays} days${progress}. Finishing started work beats starting new work.`,
    };
  }
  return {
    action: "start",
    reason: `${task.priority} priority, waiting ${task.ageDays} days and not started yet.`,
  };
}

const mockPolicy: ScriptPolicy = (ctx) => {
  type Overview = { tasks: TaskBrief[]; signals: { staleInProgress: number[]; oldTodo: number[] } };
  const overview = ctx.last<Overview>("get_board_overview");
  if (!overview) {
    return { thought: "Start with the whole board.", calls: [{ name: "get_board_overview", args: {} }] };
  }

  const ranked = [...overview.tasks].sort((a, b) => scoreTask(b) - scoreTask(a));
  const candidates = ranked.slice(0, 3);

  const detailsRead = ctx.results.some((r) => r.name === "get_task");
  if (!detailsRead) {
    return {
      thought: "Read the top candidates in detail before deciding.",
      calls: candidates.map((t) => ({ name: "get_task", args: { id: t.id } })),
    };
  }

  const focus = candidates.map((task) => ({ taskId: task.id, ...mockReason(task) }));
  const later = ranked.slice(3, 6).map((task) => ({
    taskId: task.id,
    reason: `${task.priority} priority${task.status === "todo" ? ", not started" : ""} — lower score than today's focus.`,
  }));
  const warnings: string[] = [];
  if (overview.signals.staleInProgress.length > 0) {
    warnings.push(`In progress without updates for ${STALE_IN_PROGRESS_DAYS}+ days: ${overview.signals.staleInProgress.map((id) => `#${id}`).join(", ")}.`);
  }
  if (overview.signals.oldTodo.length > 0) {
    warnings.push(`Waiting ${OLD_TODO_DAYS}+ days: ${overview.signals.oldTodo.map((id) => `#${id}`).join(", ")} — schedule or drop them.`);
  }

  return {
    calls: [
      {
        name: "finish_plan",
        args: {
          summary:
            "Mock mode (no OPENAI_API_KEY): ranked by a fixed formula — priority, in-progress bonus, subtask progress and age. Connect a real model for reasoning over descriptions and notes.",
          focus,
          later,
          warnings,
        },
      },
    ],
  };
};
