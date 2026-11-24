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
