import { describe, expect, it } from "vitest";
import { keywords, searchTasks } from "@/lib/tasks/search";
import type { Task } from "@/lib/tasks/types";

function task(id: number, title: string, description = ""): Task {
  return {
    id, title, description, status: "todo", priority: "medium", notes: "", parentId: null,
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

describe("searchTasks", () => {
  const tasks = [
    task(1, "Rate limiting for public API", "429 responses at the gateway"),
    task(2, "Fix flaky checkout e2e test"),
    task(3, "Write runbook for database failover", "primary Postgres cluster"),
  ];

  it("ranks title matches above description matches", () => {
    const hits = searchTasks(tasks, "add rate limits to the API gateway");
    expect(hits[0].task.id).toBe(1);
  });

  it("matches word stems (limit ~ limiting)", () => {
    expect(searchTasks(tasks, "limit")[0]?.task.id).toBe(1);
  });

  it("returns nothing for stop-words-only queries", () => {
    expect(searchTasks(tasks, "fix the task")).toEqual([]);
  });

  it("extracts unique, meaningful keywords", () => {
    expect(keywords("Fix the Postgres failover, postgres!")).toEqual(["postgres", "failover"]);
  });
});
