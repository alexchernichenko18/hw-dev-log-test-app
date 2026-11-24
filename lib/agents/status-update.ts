import { z } from "zod";
import { createModel } from "@/lib/agents/provider";
import { defineFinishTool, defineTool, runAgent } from "@/lib/agents/runtime";
import type { ScriptPolicy } from "@/lib/agents/scripted-model";
import { STALE_IN_PROGRESS_DAYS, taskDetail } from "@/lib/agents/task-context";
import type { TaskRepository } from "@/lib/tasks/repository";

export const AUDIENCES = ["team", "manager", "stakeholders"] as const;
export const TONES = ["shipped", "on-track", "heads-up", "blocked"] as const;

export type Audience = (typeof AUDIENCES)[number];
export type Tone = (typeof TONES)[number];

export const MESSAGE_MAX = 900;

export const statusUpdateSchema = z.object({
  tone: z
    .enum(TONES)
    .describe("shipped = done; on-track = progressing normally; heads-up = risk or slowdown; blocked = waiting on someone/something."),
  message: z
    .string()
    .min(1)
    .max(MESSAGE_MAX)
    .describe("The Slack message itself, Slack mrkdwn (*bold*, bullets with •). Short: 2-6 lines."),
  blockers: z.array(z.string().max(200)).max(3).describe("Concrete blockers mentioned in the message, empty if none."),
  askForHelp: z.string().max(200).nullable().describe("A specific ask of the team (who/what), or null if nothing is needed."),
});

export type StatusUpdate = z.infer<typeof statusUpdateSchema>;

const BLOCKER_PATTERN = /\b(block\w*|waiting|wait on|stuck|depends on|pending review|review)\b/i;

const AUDIENCE_GUIDE: Record<Audience, string> = {
  team: "Fellow engineers in the team channel: technical detail is welcome, be brief and concrete.",
  manager: "Engineering manager: focus on progress, risk, ETA confidence and what you need. Little jargon.",
  stakeholders:
    "Non-technical stakeholders: describe outcome and impact in plain language. Do not name technologies, tools, files or code (no 'Docker', 'crypto calls', 'CI', 'e2e') — translate them into what they mean for users or the business.",
};

const SYSTEM_PROMPT = `You are the status-update agent of DevLog, a task tracker for an engineering team.
You write a short async update about one task, as a Slack message from the engineer working on it.

Work in steps:
1. Call get_task to read the task, its progress notes and subtasks.
2. Call assess_progress to get objective signals (progress, time in progress, blocker hints).
3. Choose the tone from the facts, then call finish_update.

Rules:
- Facts only from the tools and the author's extra note. Never invent progress, dates, people or numbers.
- Tone must match reality: shipped only if status is done; blocked if notes say it waits on someone/something; heads-up if it is stale or at risk; otherwise on-track.
- Structure: one-line headline with the task title, then what's done, what's next, and blockers/asks only if there are any.
- If something is blocked, make the ask specific (who / what is needed).
- The author's extra note is the freshest information: it overrides older notes and staleness signals.
- Write in first person, as the engineer. 2-6 lines. Slack mrkdwn. No greetings, no sign-off, no emojis except one optional status emoji at the start.`;

export interface StatusUpdateInput {
  taskId: number;
  audience: Audience;
  note?: string;
}

export async function runStatusUpdateAgent(repo: TaskRepository, input: StatusUpdateInput, now: Date = new Date()) {
  const task = repo.getById(input.taskId);

  const getTask = defineTool({
    name: "get_task",
    description: "Full details of the task: description, progress notes and subtasks with status.",
    input: z.object({ id: z.number().int().positive() }),
    run: ({ id }) => taskDetail(repo, id, now),
    summarize: ({ id }) => `Read task #${id}`,
  });

  const assessProgress = defineTool({
    name: "assess_progress",
    description: "Objective progress signals for the task: subtask completion, staleness and blocker hints from notes.",
    input: z.object({ id: z.number().int().positive() }),
    run: ({ id }) => assess(taskDetail(repo, id, now), Boolean(input.note?.trim())),
    summarize: (_input, output) => {
      const signals = output as ReturnType<typeof assess>;
      return `Assessed progress: ${signals.subtasks.done}/${signals.subtasks.total} subtasks${signals.blockerHint ? ", possible blocker" : ""}${signals.stale ? ", stale" : ""}`;
    },
  });

  const finishUpdate = defineFinishTool({
    name: "finish_update",
    description: "Return the status update. Ends the run.",
    output: statusUpdateSchema,
    check: (update) => {
      const problems: string[] = [];
      const current = repo.getById(task.id);
      if (update.tone === "shipped" && current.status !== "done") {
        problems.push(`tone "shipped" but the task status is "${current.status}"`);
      }
      if (update.tone === "blocked" && update.blockers.length === 0) {
        problems.push(`tone "blocked" needs at least one concrete blocker`);
      }
      const knownIds = new Set(repo.listAll().map((t) => t.id));
      for (const match of update.message.matchAll(/#(\d+)/g)) {
        if (!knownIds.has(Number(match[1]))) problems.push(`message references unknown task #${match[1]}`);
      }
      return problems;
    },
  });

  const message = [
    `Write a status update for task #${task.id}.`,
    `Audience: ${input.audience}. ${AUDIENCE_GUIDE[input.audience]}`,
    input.note?.trim() ? `Extra note from the author (treat as fact): ${input.note.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await runAgent({
    name: "status-update",
    system: SYSTEM_PROMPT,
    input: message,
    tools: [getTask, assessProgress],
    finishTools: { finish_update: finishUpdate },
    model: createModel(mockPolicy(input)),
    maxSteps: 6,
  });

  const update = result.finish.output as StatusUpdate;
  return { ...result, update: { ...update, message: toSlackMrkdwn(update.message) } };
}

/** Models often emit Markdown; Slack mrkdwn uses single asterisks for bold and no headings. */
export function toSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/^[-*]\s+/gm, "• ")
    .trim();
}

type Detail = ReturnType<typeof taskDetail>;

/** `freshNote`: the author just reported progress, so the task is not stale regardless of updatedAt. */
function assess(detail: Detail, freshNote: boolean) {
  const done = detail.subtasks.filter((s) => s.status === "done").length;
  const total = detail.subtasks.length;
  return {
    status: detail.status,
    subtasks: { done, total, remaining: detail.subtasks.filter((s) => s.status !== "done").map((s) => s.title) },
    progressPercent: total > 0 ? Math.round((done / total) * 100) : null,
    daysSinceCreated: detail.ageDays,
    daysSinceUpdate: detail.daysSinceUpdate,
    stale: !freshNote && detail.status === "in-progress" && detail.daysSinceUpdate >= STALE_IN_PROGRESS_DAYS,
    freshNoteFromAuthor: freshNote,
    blockerHint: BLOCKER_PATTERN.test(detail.notes) ? detail.notes.match(BLOCKER_PATTERN)?.[0] ?? null : null,
    hasNotes: detail.notes.trim().length > 0,
  };
}

// ---------------------------------------------------------------------------
// Mock policy — fills a fixed template from the same signals.
// ---------------------------------------------------------------------------

function mockPolicy(input: StatusUpdateInput): ScriptPolicy {
  return (ctx) => {
    const detail = ctx.last<Detail>("get_task");
    if (!detail) return { calls: [{ name: "get_task", args: { id: input.taskId } }] };
    const signals = ctx.last<ReturnType<typeof assess>>("assess_progress");
    if (!signals) return { calls: [{ name: "assess_progress", args: { id: input.taskId } }] };

    const tone: Tone =
      detail.status === "done" ? "shipped" : signals.blockerHint ? "blocked" : signals.stale ? "heads-up" : "on-track";
    const emoji = { shipped: "✅", "on-track": "🟢", "heads-up": "🟡", blocked: "🔴" }[tone];
    const lines = [`${emoji} *${detail.title}* — ${tone.replace("-", " ")}`];
    if (signals.subtasks.total > 0) lines.push(`• Progress: ${signals.subtasks.done}/${signals.subtasks.total} subtasks done`);
    if (detail.notes) lines.push(`• Notes: ${detail.notes.split(/(?<=\.)\s/)[0]}`);
    if (signals.subtasks.remaining.length > 0 && tone !== "shipped") lines.push(`• Next: ${signals.subtasks.remaining[0]}`);
    if (input.note?.trim()) lines.push(`• ${input.note.trim()}`);
    const blockers = tone === "blocked" ? [detail.notes.split(/(?<=\.)\s/).find((s) => BLOCKER_PATTERN.test(s)) ?? detail.notes] : [];
    if (blockers.length > 0) lines.push(`• Blocked: ${blockers[0]}`);

    return {
      calls: [
        {
          name: "finish_update",
          args: {
            tone,
            message: lines.join("\n").slice(0, MESSAGE_MAX),
            blockers,
            askForHelp: tone === "blocked" ? "Can someone help unblock this?" : null,
          },
        },
      ],
    };
  };
}
