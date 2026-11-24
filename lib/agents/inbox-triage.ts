import { z } from "zod";
import { createModel } from "@/lib/agents/provider";
import { defineFinishTool, defineTool, runAgent } from "@/lib/agents/runtime";
import type { ScriptPolicy } from "@/lib/agents/scripted-model";
import { taskDetail } from "@/lib/agents/task-context";
import type { TaskRepository } from "@/lib/tasks/repository";
import { taskPrioritySchema } from "@/lib/tasks/schema";
import { keywords, searchTasks } from "@/lib/tasks/search";
import { TITLE_MAX } from "@/lib/tasks/types";

export const INBOX_TEXT_MAX = 6_000;
export const TRIAGE_ACTIONS = ["create", "update", "skip"] as const;

export const triageItemSchema = z.object({
  action: z
    .enum(TRIAGE_ACTIONS)
    .describe("create = new task; update = the item belongs to an existing task; skip = duplicate of done work or not actionable."),
  sourceQuote: z
    .string()
    .min(1)
    .max(300)
    .describe("Exact, verbatim fragment of the input text this item comes from. Copy it character for character."),
  title: z.string().trim().min(1).max(TITLE_MAX).describe("For create: the new task title. For update/skip: short label of the item."),
  description: z.string().max(1000).describe("For create: context for the task. Otherwise empty."),
  priority: taskPrioritySchema.describe("For create: priority of the new task. For update: the priority the existing task should have."),
  taskId: z.number().int().nullable().describe("For update/skip: the related existing task id. For create: null."),
  note: z.string().max(500).nullable().describe("For update: the line to append to the existing task's notes. Otherwise null."),
  reason: z.string().min(1).max(300).describe("Why this action — e.g. which existing task matched and why."),
});

export const triageSchema = z.object({
  summary: z.string().min(1).max(400).describe("One or two sentences: what was found in the text."),
  items: z.array(triageItemSchema).max(12),
});

export type TriageItem = z.infer<typeof triageItemSchema>;
export type Triage = z.infer<typeof triageSchema>;

const SYSTEM_PROMPT = `You are the inbox triage agent of DevLog, a task tracker for an engineering team.
The user pastes raw text — meeting notes, a Slack thread, a bug report, PR review comments. You turn it into tracker changes.

Work in steps:
1. Read the text and identify concrete action items: things someone has to do. Ignore chit-chat, decisions without follow-up, and FYIs.
2. For EVERY action item call search_tasks with that item's own key terms (one search per item; several in one turn is fine). Results include subtasks (parentId set) and done tasks — both count as "already on the board".
3. Call get_task on a match when you need its details to decide (e.g. to see whether it's done or what its notes say).
4. Call finish_triage with one item per action item.

Deciding per item:
- create: nothing on the board covers it. Write a clear, verb-first title and keep the original context in the description.
- update: an existing open task covers it and the text adds new information (a deadline, a new finding, an unblock, a bumped priority). Put that new information in note; set priority to what the task should now have. News that something is approved/unblocked/done is an update to that task.
- Only match when it is genuinely the same piece of work — sharing a word like "API" or "error" is not enough. When unsure, create.
- skip: an existing task already covers it with nothing new, or it's done already, or it's not actionable. Always say which task in reason.
- Priority: high for production incidents, security, customer-facing breakage, explicit urgency; low for nice-to-haves; medium otherwise.

Hard rules:
- sourceQuote must be copied verbatim from the input — it is checked.
- Never invent action items that are not in the text. If the text has none, return an empty items list.
- Only reference task ids returned by the tools.`;

/** Existing task (or subtask) whose title is the same as `title`, ignoring case and punctuation. */
export function findSameTitle(repo: TaskRepository, title: string) {
  const key = keywords(title).join(" ");
  if (!key) return null;
  return repo.listAll().find((task) => keywords(task.title).join(" ") === key) ?? null;
}

/**
 * Terms shared between an inbox item and the task it points at (title, description, notes, subtasks).
 * Empty = the agent linked text to a task with nothing in common — likely a wrong match.
 * Used as a soft signal in the UI, not a hard rejection: the heuristic has false negatives.
 */
export function sharedTerms(repo: TaskRepository, item: Pick<TriageItem, "sourceQuote" | "note">, taskId: number): string[] {
  const task = repo.getWithSubtasks(taskId);
  const taskTerms = keywords(
    [task.title, task.description, task.notes, ...task.subtasks.map((s) => s.title)].join(" "),
  );
  return keywords(`${item.sourceQuote} ${item.note ?? ""}`).filter((term) =>
    taskTerms.some((t) => t.startsWith(term) || term.startsWith(t)),
  );
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

export async function runInboxTriageAgent(repo: TaskRepository, text: string, now: Date = new Date()) {
  const normalizedInput = normalize(text);

  const searchTool = defineTool({
    name: "search_tasks",
    description: "Find existing tasks (including subtasks and done tasks) related to the given keywords.",
    input: z.object({ query: z.string().min(1).max(200) }),
    run: ({ query }) =>
      searchTasks(repo.listAll(), query).map((hit) => ({
        id: hit.task.id,
        title: hit.task.title,
        status: hit.task.status,
        priority: hit.task.priority,
        parentId: hit.task.parentId,
        matched: hit.matched,
      })),
    summarize: ({ query }, output) => {
      const count = (output as unknown[]).length;
      return `Searched “${query}”: ${count} match${count === 1 ? "" : "es"}`;
    },
  });

  const getTask = defineTool({
    name: "get_task",
    description: "Full details of an existing task.",
    input: z.object({ id: z.number().int().positive() }),
    run: ({ id }) => taskDetail(repo, id, now),
    summarize: ({ id }) => `Read task #${id}`,
  });

  const finishTriage = defineFinishTool({
    name: "finish_triage",
    description: "Return the triage result. Ends the run. Nothing is applied until the user confirms.",
    output: triageSchema,
    check: (triage) => {
      const problems: string[] = [];
      const updated = new Set<number>();
      triage.items.forEach((item, index) => {
        const label = `item ${index + 1} ("${item.title}")`;
        if (!normalizedInput.includes(normalize(item.sourceQuote))) {
          problems.push(`${label}: sourceQuote is not a verbatim fragment of the input`);
        }
        if (item.action === "update" || item.action === "skip") {
          if (item.taskId === null || !repo.findById(item.taskId)) {
            problems.push(`${label}: ${item.action} needs an existing taskId`);
          }
        }
        if (item.action === "update") {
          if (!item.note?.trim()) problems.push(`${label}: update needs a note with the new information`);
          if (item.taskId !== null && updated.has(item.taskId)) {
            problems.push(`${label}: task ${item.taskId} is updated twice — merge the notes into one item`);
          }
          if (item.taskId !== null) updated.add(item.taskId);
        }
        if (item.action === "create" && item.taskId !== null) problems.push(`${label}: create must have taskId null`);
        if (item.action === "create") {
          const existing = findSameTitle(repo, item.title);
          if (existing) {
            const where = existing.parentId ? `subtask of #${existing.parentId}` : "task";
            problems.push(
              `${label}: "${existing.title}" already exists as ${where} #${existing.id} — use update (with the new information) or skip`,
            );
          }
        }
      });
      return problems;
    },
  });

  const result = await runAgent({
    name: "inbox-triage",
    system: SYSTEM_PROMPT,
    input: `Triage this text:\n"""\n${text}\n"""`,
    tools: [searchTool, getTask],
    finishTools: { finish_triage: finishTriage },
    model: createModel(mockPolicy(text)),
    maxSteps: 8,
  });

  return { ...result, triage: result.finish.output as Triage };
}

// ---------------------------------------------------------------------------
// Mock policy — line-based extraction + keyword search, no understanding.
// ---------------------------------------------------------------------------

const ACTION_LINE = /\b(need|needs|asked|is next|should|must|will|todo|action|fix|add|investigate|update|write|set up|follow up|look into|migrate|remove)\b/i;
const URGENT = /\b(urgent|asap|prod(uction)?|outage|incident|security|blocker|customers?)\b/i;

export function extractActionLines(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^\s*([-*•]|\d+[.)]|\[ \])\s*/, "").trim())
    .filter((line) => line.length > 8 && ACTION_LINE.test(line))
    .slice(0, 8);
}

function mockPolicy(text: string): ScriptPolicy {
  return (ctx) => {
    const lines = extractActionLines(text);
    const searches = ctx.results.filter((r) => r.name === "search_tasks");
    if (searches.length === 0 && lines.length > 0) {
      return {
        thought: `Found ${lines.length} action-looking line(s); checking each against the board.`,
        calls: lines.map((line) => ({ name: "search_tasks", args: { query: line } })),
      };
    }

    type Hit = { id: number; title: string; status: string; matched: string[] };
    const updated = new Set<number>();
    const items = lines.map((line, index) => {
      const hits = (searches[index]?.result as Hit[] | undefined) ?? [];
      const best = hits.find((h) => h.matched.length >= 2);
      const priority = URGENT.test(line) ? "high" : "medium";
      if (best && best.status === "done") {
        return { action: "skip", sourceQuote: line, title: line.slice(0, 80), description: "", priority, taskId: best.id, note: null, reason: `Looks like done task #${best.id}.` };
      }
      if (best && !updated.has(best.id)) {
        updated.add(best.id);
        return { action: "update", sourceQuote: line, title: line.slice(0, 80), description: "", priority, taskId: best.id, note: `From inbox: ${line}`, reason: `Shares keywords with #${best.id} (${best.matched.join(", ")}).` };
      }
      return { action: "create", sourceQuote: line, title: line.slice(0, 80), description: line, priority, taskId: null, note: null, reason: "No matching task on the board." };
    });

    return {
      calls: [
        {
          name: "finish_triage",
          args: {
            summary: `Mock mode (no OPENAI_API_KEY): ${items.length} action-looking line(s) matched by keywords, not understood.`,
            items,
          },
        },
      ],
    };
  };
}
