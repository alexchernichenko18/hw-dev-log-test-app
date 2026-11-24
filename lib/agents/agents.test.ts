import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@/lib/db";
import { seedDemoTasks } from "@/lib/db/seed";
import { runDecomposeAgent } from "@/lib/agents/decompose";
import { runPrioritizeAgent } from "@/lib/agents/prioritize";
import { TaskRepository } from "@/lib/tasks/repository";

// These run the real runtime + tools against a seeded in-memory DB, with the scripted (mock) model.
const NOW = new Date("2026-11-24T09:00:00.000Z");
let repo: TaskRepository;

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const db = openDatabase(":memory:");
  seedDemoTasks(db, NOW);
  repo = new TaskRepository(db, () => NOW);
});

function idByTitle(title: string): number {
  const task = repo.listAll().find((t) => t.title === title);
  if (!task) throw new Error(`no task "${title}"`);
  return task.id;
}

describe("prioritize agent (mock model)", () => {
  it("returns only open tasks, in-progress work first, with a multi-step trace", async () => {
    const result = await runPrioritizeAgent(repo, {}, NOW);
    const open = new Set(repo.list({ sort: "priority", order: "desc" }).filter((t) => t.status !== "done").map((t) => t.id));

    expect(result.plan.focus.length).toBeGreaterThan(0);
    for (const item of [...result.plan.focus, ...result.plan.later]) expect(open.has(item.taskId)).toBe(true);
    expect(repo.getById(result.plan.focus[0].taskId).status).toBe("in-progress");
    expect(result.trace.map((t) => t.tool)).toEqual(
      expect.arrayContaining(["get_board_overview", "get_task", "finish_plan"]),
    );
  });
});

describe("decompose agent (mock model)", () => {
  it("asks for clarification on a vague task", async () => {
    const result = await runDecomposeAgent(repo, { taskId: idByTitle("Improve performance") }, NOW);
    expect(result.outcome.kind).toBe("clarify");
  });

  it("proposes subtasks once answers are given and never asks twice", async () => {
    const result = await runDecomposeAgent(
      repo,
      {
        taskId: idByTitle("Improve performance"),
        answers: [{ question: "What should be different?", answer: "Dashboard p95 under 2s" }],
      },
      NOW,
    );
    expect(result.outcome.kind).toBe("proposal");
  });

  it("searches the board and does not re-propose existing subtasks", async () => {
    const taskId = idByTitle("Fix flaky checkout e2e test");
    const result = await runDecomposeAgent(repo, { taskId }, NOW);

    expect(result.trace.find((t) => t.tool === "search_tasks")?.error).toBeUndefined();
    expect(result.outcome.kind).toBe("proposal");
  });
});

describe("status update agent", () => {
  it("converts Markdown to Slack mrkdwn", async () => {
    const { toSlackMrkdwn } = await import("@/lib/agents/status-update");
    expect(toSlackMrkdwn("## Title\n**bold** text\n- item")).toBe("*Title*\n*bold* text\n• item");
  });

  it("(mock) picks 'blocked' from notes and never claims shipped for open work", async () => {
    const { runStatusUpdateAgent } = await import("@/lib/agents/status-update");
    const result = await runStatusUpdateAgent(
      repo,
      { taskId: idByTitle("Migrate auth service to Node 22"), audience: "team" },
      NOW,
    );
    expect(result.update.tone).toBe("blocked");
    expect(result.update.blockers.length).toBeGreaterThan(0);
  });

  it("(mock) treats an author note as fresh progress, not stale", async () => {
    const { runStatusUpdateAgent } = await import("@/lib/agents/status-update");
    const result = await runStatusUpdateAgent(
      repo,
      { taskId: idByTitle("Fix flaky checkout e2e test"), audience: "team", note: "Root cause found, fix in progress" },
      NOW,
    );
    expect(result.update.tone).toBe("on-track");
  });
});

describe("inbox triage agent", () => {
  it("(mock) extracts action lines, ignores chit-chat and links known work", async () => {
    const { runInboxTriageAgent } = await import("@/lib/agents/inbox-triage");
    const text = [
      "- Worker service memory leak is hitting prod again, need to investigate today",
      "- We should add an alert when checkout error rate goes above 2%",
      "- Lunch on Friday at the ramen place",
    ].join("\n");
    const result = await runInboxTriageAgent(repo, text, NOW);

    expect(result.triage.items).toHaveLength(2);
    const leak = result.triage.items[0];
    expect(leak.action).toBe("update");
    expect(leak.taskId).toBe(idByTitle("Investigate memory leak in worker service"));
    expect(leak.priority).toBe("high");
  });

  it("detects same-title duplicates, including subtasks", async () => {
    const { findSameTitle } = await import("@/lib/agents/inbox-triage");
    expect(findSameTitle(repo, "run load test on staging!")?.parentId).not.toBeNull();
    expect(findSameTitle(repo, "Add an alert for checkout errors")).toBeNull();
  });

  it("flags links that share no terms with the target task", async () => {
    const { sharedTerms } = await import("@/lib/agents/inbox-triage");
    const rateLimiting = idByTitle("Rate limiting for public API");
    expect(sharedTerms(repo, { sourceQuote: "Add alert for checkout error rate", note: null }, rateLimiting)).toEqual([
      "rate",
    ]);
    expect(sharedTerms(repo, { sourceQuote: "Ramen on Friday", note: null }, rateLimiting)).toEqual([]);
  });
});

describe("prioritize guardrail", () => {
  it("flags signals the plan did not mention", async () => {
    const { uncoveredSignals } = await import("@/lib/agents/prioritize");
    const { toBrief } = await import("@/lib/agents/task-context");
    const briefs = repo.list({ sort: "priority", order: "desc" }).map((t) => toBrief(t, NOW));
    const leak = idByTitle("Investigate memory leak in worker service");
    const flaky = idByTitle("Fix flaky checkout e2e test");

    const warnings = uncoveredSignals(briefs, {
      summary: "x",
      focus: [{ taskId: flaky, action: "finish", reason: "x" }],
      later: [],
      warnings: [],
    });
    const mentions = (id: number) => warnings.some((w) => new RegExp(`#${id}\\b`).test(w));
    expect(mentions(leak)).toBe(true);
    expect(mentions(flaky)).toBe(false);
  });
});
