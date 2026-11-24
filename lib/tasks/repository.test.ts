import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { seedDemoTasks } from "@/lib/db/seed";
import {
  InvalidParentError,
  TaskNotFoundError,
  TaskRepository,
} from "@/lib/tasks/repository";
import { taskCreateSchema, taskListQuerySchema } from "@/lib/tasks/schema";

let clock: Date;
let repo: TaskRepository;

function create(input: Parameters<typeof taskCreateSchema.parse>[0]) {
  return repo.create(taskCreateSchema.parse(input));
}

function advance(ms: number) {
  clock = new Date(clock.getTime() + ms);
}

beforeEach(() => {
  clock = new Date("2026-11-20T10:00:00.000Z");
  repo = new TaskRepository(openDatabase(":memory:"), () => clock);
});

describe("TaskRepository", () => {
  it("creates a task with defaults and timestamps", () => {
    const task = create({ title: "  Ship it  " });
    expect(task).toMatchObject({
      title: "Ship it",
      description: "",
      status: "todo",
      priority: "medium",
      parentId: null,
      createdAt: "2026-11-20T10:00:00.000Z",
    });
  });

  it("filters by status and returns only top-level tasks", () => {
    const parent = create({ title: "Parent", status: "in-progress" });
    create({ title: "Other", status: "todo" });
    repo.createSubtasks(parent.id, [{ title: "Child", description: "", priority: "low" }]);

    const inProgress = repo.list(taskListQuerySchema.parse({ status: "in-progress" }));
    expect(inProgress.map((t) => t.title)).toEqual(["Parent"]);
    expect(inProgress[0]).toMatchObject({ subtaskCount: 1, subtaskDoneCount: 0 });

    const all = repo.list(taskListQuerySchema.parse({}));
    expect(all.map((t) => t.title)).not.toContain("Child");
  });

  it("sorts by priority (high first by default desc), ties broken by newest", () => {
    create({ title: "low", priority: "low" });
    advance(1000);
    create({ title: "high-old", priority: "high" });
    advance(1000);
    create({ title: "high-new", priority: "high" });
    create({ title: "medium", priority: "medium" });

    const desc = repo.list(taskListQuerySchema.parse({ sort: "priority", order: "desc" }));
    expect(desc.map((t) => t.title)).toEqual(["high-new", "high-old", "medium", "low"]);

    const asc = repo.list(taskListQuerySchema.parse({ sort: "priority", order: "asc" }));
    expect(asc[0].title).toBe("low");
  });

  it("sorts by creation date in both directions", () => {
    create({ title: "first" });
    advance(1000);
    create({ title: "second" });

    expect(repo.list(taskListQuerySchema.parse({})).map((t) => t.title)).toEqual(["second", "first"]);
    expect(
      repo.list(taskListQuerySchema.parse({ order: "asc" })).map((t) => t.title),
    ).toEqual(["first", "second"]);
  });

  it("updates only provided fields and bumps updatedAt", () => {
    const task = create({ title: "Old", priority: "low" });
    advance(60_000);
    const updated = repo.update(task.id, { status: "done" });

    expect(updated).toMatchObject({ title: "Old", priority: "low", status: "done" });
    expect(updated.updatedAt).toBe("2026-11-20T10:01:00.000Z");
    expect(updated.createdAt).toBe(task.createdAt);
  });

  it("deletes a task together with its subtasks", () => {
    const parent = create({ title: "Parent" });
    const [child] = repo.createSubtasks(parent.id, [
      { title: "Child", description: "", priority: "medium" },
    ]);

    repo.delete(parent.id);
    expect(repo.findById(parent.id)).toBeNull();
    expect(repo.findById(child.id)).toBeNull();
  });

  it("throws TaskNotFoundError for unknown ids", () => {
    expect(() => repo.update(999, { title: "x" })).toThrow(TaskNotFoundError);
    expect(() => repo.delete(999)).toThrow(TaskNotFoundError);
    expect(() => repo.createSubtasks(999, [{ title: "x", description: "", priority: "low" }])).toThrow(
      TaskNotFoundError,
    );
  });

  it("allows only one level of subtasks and creates them atomically", () => {
    const parent = create({ title: "Parent" });
    const [child] = repo.createSubtasks(parent.id, [
      { title: "Child", description: "", priority: "medium" },
    ]);

    expect(() =>
      repo.createSubtasks(child.id, [{ title: "Grandchild", description: "", priority: "low" }]),
    ).toThrow(InvalidParentError);
    expect(repo.listSubtasks(child.id)).toEqual([]);
  });
});

describe("seedDemoTasks", () => {
  it("writes demo tasks with subtasks and backdated createdAt", () => {
    const db = openDatabase(":memory:");
    seedDemoTasks(db, new Date("2026-11-20T00:00:00.000Z"));
    const seeded = new TaskRepository(db);

    const tasks = seeded.list(taskListQuerySchema.parse({ order: "asc" }));
    expect(tasks.length).toBeGreaterThan(5);
    expect(tasks[0].createdAt < "2026-11-01").toBe(true);
    expect(tasks.some((t) => t.subtaskCount > 0)).toBe(true);
  });
});

describe("schemas", () => {
  it("rejects empty titles and unknown statuses", () => {
    expect(taskCreateSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "ok", status: "blocked" }).success).toBe(false);
  });

  it("rejects unknown list query values", () => {
    expect(taskListQuerySchema.safeParse({ sort: "title" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ status: "doing" }).success).toBe(false);
  });
});
