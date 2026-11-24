import { z } from "zod";
import { createModel } from "@/lib/agents/provider";
import { defineFinishTool, defineTool, runAgent, type RegisteredFinishTool } from "@/lib/agents/runtime";
import type { ScriptPolicy } from "@/lib/agents/scripted-model";
import { taskDetail } from "@/lib/agents/task-context";
import type { TaskRepository } from "@/lib/tasks/repository";
import { taskPrioritySchema } from "@/lib/tasks/schema";
import { searchTasks } from "@/lib/tasks/search";
import { TITLE_MAX } from "@/lib/tasks/types";

export const clarificationSchema = z.object({
  reason: z.string().min(1).max(300).describe("What exactly is unclear about the task, in one sentence."),
  questions: z
    .array(
      z.object({
        question: z.string().min(1).max(200),
        options: z
          .array(z.string().min(1).max(80))
          .max(4)
          .describe("Optional likely answers to click; the user can also type their own."),
      }),
    )
    .min(1)
    .max(3),
});

export const proposalSchema = z.object({
  approach: z.string().min(1).max(400).describe("1-2 sentences: how the work is split and why in this order."),
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(TITLE_MAX).describe("Imperative, concrete, starts with a verb."),
        description: z.string().max(500).describe("Done-criteria or key detail, one or two sentences."),
        priority: taskPrioritySchema,
      }),
    )
    .min(2)
    .max(8)
    .describe("Ordered steps. Each should be doable in under a day."),
  assumptions: z.array(z.string().max(200)).max(4).describe("Assumptions made where the task was not explicit."),
});

export type Clarification = z.infer<typeof clarificationSchema>;
export type Proposal = z.infer<typeof proposalSchema>;

export const answersSchema = z
  .array(z.object({ question: z.string().max(200), answer: z.string().trim().max(500) }))
  .max(3);

export type ClarificationAnswer = z.infer<typeof answersSchema>[number];

export type DecomposeOutcome =
  | { kind: "clarify"; clarification: Clarification }
  | { kind: "proposal"; proposal: Proposal };

const SYSTEM_PROMPT = `You are the decomposition agent of DevLog, a task tracker for an engineering team.
You break one task into concrete subtasks that an engineer can pick up.

Work in steps:
1. Call get_task to read the task, its notes and existing subtasks.
2. Call search_tasks with the key terms of the task to find related or overlapping work elsewhere on the board.
3. Decide:
   - If the task is too vague to split well — no clear outcome, unknown scope, or several very different interpretations — call ask_clarification with 1-3 short, specific questions. Offer likely answers as options where possible.
   - Otherwise call propose_subtasks.

Rules for subtasks:
- 2-8 steps, ordered, each finishable in under a day, each starting with a verb.
- Do not repeat existing subtasks of this task. If related work exists in another task, do not duplicate it — mention the dependency in the approach.
- Include verification (tests, monitoring, rollout) when it matters for this kind of work.
- Priority per subtask reflects its importance within this task (blocking or risky steps higher).
- Do not invent facts about the system; put guesses in assumptions.`;

const AFTER_ANSWERS_NOTE =
  "The user has already answered clarifying questions (below). Do not ask again — propose subtasks, recording anything still uncertain as assumptions.";

export interface DecomposeInput {
  taskId: number;
  answers?: ClarificationAnswer[];
}

export async function runDecomposeAgent(repo: TaskRepository, input: DecomposeInput, now: Date = new Date()) {
  // Fail fast with a 404 before spending model calls on a task that doesn't exist.
  const task = repo.getById(input.taskId);
  const existingSubtasks = repo.listSubtasks(task.id);

  const getTask = defineTool({
    name: "get_task",
    description: "Full details of a task: description, notes and existing subtasks.",
    input: z.object({ id: z.number().int().positive() }),
    run: ({ id }) => taskDetail(repo, id, now),
    summarize: ({ id }) => `Read task #${id}`,
  });

  const searchTool = defineTool({
    name: "search_tasks",
    description: "Find other tasks on the board related to the given keywords (titles and descriptions).",
    input: z.object({ query: z.string().min(1).max(200) }),
    run: ({ query }) =>
      searchTasks(repo.listAll(), query)
        .filter((hit) => hit.task.id !== task.id && hit.task.parentId !== task.id)
        .map((hit) => ({
          id: hit.task.id,
          title: hit.task.title,
          status: hit.task.status,
          parentId: hit.task.parentId,
          matched: hit.matched,
        })),
    summarize: ({ query }, output) => {
      const count = (output as unknown[]).length;
      return `Searched “${query}”: ${count} related task${count === 1 ? "" : "s"}`;
    },
  });

  const askClarification = defineFinishTool({
    name: "ask_clarification",
    description: "Ask the user clarifying questions instead of guessing. Ends the run; it resumes with the answers.",
    output: clarificationSchema,
  });

  const proposeSubtasks = defineFinishTool({
    name: "propose_subtasks",
    description: "Return the proposed subtasks. Ends the run. Nothing is created until the user confirms.",
    output: proposalSchema,
    check: (proposal) => {
      const problems: string[] = [];
      const existing = new Set(existingSubtasks.map((s) => s.title.trim().toLowerCase()));
      const seen = new Set<string>();
      for (const { title } of proposal.subtasks) {
        const key = title.trim().toLowerCase();
        if (existing.has(key)) problems.push(`"${title}" already exists as a subtask`);
        if (seen.has(key)) problems.push(`"${title}" is listed twice`);
        seen.add(key);
      }
      return problems;
    },
  });

  const answered = (input.answers ?? []).filter((a) => a.answer.length > 0);
  // One clarification round at most: once answers exist, the ask tool is simply not offered.
  const finishTools: Record<string, RegisteredFinishTool> =
    answered.length > 0
      ? { propose_subtasks: proposeSubtasks }
      : { ask_clarification: askClarification, propose_subtasks: proposeSubtasks };

  const message = [
    `Break down task #${task.id}.`,
    answered.length > 0
      ? `${AFTER_ANSWERS_NOTE}\n${answered.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await runAgent({
    name: "decompose",
    system: SYSTEM_PROMPT,
    input: message,
    tools: [getTask, searchTool],
    finishTools,
    model: createModel(mockPolicy(answered)),
    maxSteps: 6,
  });

  const outcome: DecomposeOutcome =
    result.finish.tool === "ask_clarification"
      ? { kind: "clarify", clarification: result.finish.output as Clarification }
      : { kind: "proposal", proposal: result.finish.output as Proposal };

  return { ...result, outcome };
}

// ---------------------------------------------------------------------------
// Mock policy — keyword templates instead of reasoning.
// ---------------------------------------------------------------------------

type Detail = ReturnType<typeof taskDetail>;
type Draft = Proposal["subtasks"][number];

const TEMPLATES: { match: RegExp; steps: [string, string, Draft["priority"]][] }[] = [
  {
    match: /\b(bug|fix|flaky|leak|crash|error|fail)/i,
    steps: [
      ["Reproduce the issue reliably", "A script or test that fails the same way every time.", "high"],
      ["Find the root cause", "Write down the cause in the task notes before changing code.", "high"],
      ["Implement the fix", "Smallest change that addresses the root cause.", "high"],
      ["Add a regression test", "Fails without the fix, passes with it.", "medium"],
      ["Verify in staging and monitor after release", "Check dashboards / CI runs for a day.", "medium"],
    ],
  },
  {
    match: /\b(migrat|upgrade|update)/i,
    steps: [
      ["Inventory what has to change", "List breaking changes and affected modules.", "high"],
      ["Upgrade in a branch and fix breakages", "Build and unit tests green.", "high"],
      ["Run integration / load tests", "Compare with the current baseline.", "medium"],
      ["Roll out gradually with a rollback plan", "Canary first, then full rollout.", "medium"],
    ],
  },
  {
    match: /\b(runbook|document|docs|write)/i,
    steps: [
      ["Collect the current procedure from the people who know it", "Short interview or notes from the last incident.", "medium"],
      ["Draft the document", "Step-by-step, with commands and owners.", "medium"],
      ["Dry-run the procedure with someone else", "Fix every step that was unclear.", "high"],
      ["Publish and link it from the on-call handbook", "", "low"],
    ],
  },
];

const DEFAULT_STEPS: [string, string, Draft["priority"]][] = [
  ["Clarify scope and acceptance criteria", "Agree what 'done' means with the requester.", "high"],
  ["Design the approach", "Short written plan; flag risky parts.", "medium"],
  ["Implement the core change", "", "high"],
  ["Test and review", "Automated tests plus code review.", "medium"],
  ["Ship and announce", "Release notes / message to the team.", "low"],
];

function isVague(detail: Detail): boolean {
  const words = `${detail.title} ${detail.description}`.split(/\s+/).filter(Boolean).length;
  return words < 12;
}

function mockPolicy(answers: ClarificationAnswer[]): ScriptPolicy {
  return (ctx) => {
    const detail = ctx.last<Detail>("get_task");
    if (!detail) {
      const id = Number(ctx.input.match(/#(\d+)/)?.[1]);
      return { thought: "Read the task first.", calls: [{ name: "get_task", args: { id } }] };
    }
    if (!ctx.results.some((r) => r.name === "search_tasks")) {
      return {
        thought: "Check for related work on the board.",
        calls: [{ name: "search_tasks", args: { query: detail.title } }],
      };
    }

    if (answers.length === 0 && isVague(detail)) {
      return {
        calls: [
          {
            name: "ask_clarification",
            args: {
              reason: "The task is too short to tell what outcome is expected.",
              questions: [
                { question: "What exactly should be different when this is done?", options: [] },
                { question: "Which part of the system does this affect?", options: ["Frontend", "Backend / API", "Infrastructure"] },
              ],
            },
          },
        ],
      };
    }

    const template = TEMPLATES.find((t) => t.match.test(`${detail.title} ${detail.description}`));
    const existing = new Set(detail.subtasks.map((s) => s.title.toLowerCase()));
    const subtasks = (template?.steps ?? DEFAULT_STEPS)
      .map(([title, description, priority]) => ({ title, description, priority }))
      .filter((s) => !existing.has(s.title.toLowerCase()));

    return {
      calls: [
        {
          name: "propose_subtasks",
          args: {
            approach: `Mock mode (no OPENAI_API_KEY): a ${template ? "keyword-matched" : "generic"} template, not reasoning about this specific task.`,
            subtasks,
            assumptions: answers.map((a) => `${a.question} → ${a.answer}`),
          },
        },
      ],
    };
  };
}
