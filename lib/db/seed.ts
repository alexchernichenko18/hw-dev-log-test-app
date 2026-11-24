import type { Db } from "@/lib/db";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/schema";

interface SeedTask {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes?: string;
  ageDays: number;
  subtasks?: { title: string; status: TaskStatus; priority: TaskPriority }[];
}

/**
 * Demo data written once, when the database file is created for the first time.
 * Ages and states are deliberately mixed so the agents have something to reason about:
 * a stale in-progress task, an old low-priority task, a vague task, a task with notes.
 */
const DEMO_TASKS: SeedTask[] = [
  {
    title: "Fix flaky checkout e2e test",
    description:
      "checkout.spec.ts fails ~1 in 5 runs on CI with a timeout waiting for the payment iframe. Blocks merges to main when it hits.",
    status: "in-progress",
    priority: "high",
    notes:
      "Reproduced locally with CPU throttling. Suspect the iframe loads before the mock server is ready. Tried increasing timeout — not a fix.",
    ageDays: 6,
  },
  {
    title: "Migrate auth service to Node 22",
    description:
      "Node 18 is EOL. Upgrade the auth service runtime, fix deprecated crypto calls, update the Docker base image.",
    status: "in-progress",
    priority: "medium",
    notes: "Docker image updated. Waiting on security team review of the new crypto calls.",
    ageDays: 12,
    subtasks: [
      { title: "Update Docker base image", status: "done", priority: "medium" },
      { title: "Replace deprecated crypto.createCipher calls", status: "done", priority: "high" },
      { title: "Run load test on staging", status: "todo", priority: "medium" },
    ],
  },
  {
    title: "Rate limiting for public API",
    description:
      "Partner traffic spikes took down /v1/search twice last month. Add per-key rate limiting at the gateway with sane defaults and 429 responses.",
    status: "todo",
    priority: "high",
    ageDays: 3,
  },
  {
    title: "Improve performance",
    description: "The app feels slow.",
    status: "todo",
    priority: "medium",
    ageDays: 9,
  },
  {
    title: "Add dark mode to admin dashboard",
    description: "Several team members asked for it. Use existing design tokens.",
    status: "todo",
    priority: "low",
    ageDays: 21,
  },
  {
    title: "Write runbook for database failover",
    description:
      "We had a failover drill and nobody knew the exact steps. Document the procedure for the primary Postgres cluster.",
    status: "todo",
    priority: "medium",
    ageDays: 27,
  },
  {
    title: "Investigate memory leak in worker service",
    description:
      "Worker pods restart every ~18h with OOMKilled. Heap grows linearly under steady load.",
    status: "todo",
    priority: "high",
    ageDays: 1,
  },
  {
    title: "Set up error tracking for mobile web",
    description: "Integrate the error tracker SDK, upload source maps from CI, route alerts to #mobile.",
    status: "done",
    priority: "medium",
    notes: "Shipped. Source maps upload in the release job. First real bug caught on day one.",
    ageDays: 15,
  },
  {
    title: "Clean up unused feature flags",
    description: "There are 40+ flags older than 6 months. Remove the ones fully rolled out.",
    status: "todo",
    priority: "low",
    ageDays: 45,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function seedDemoTasks(db: Db, now: Date = new Date()): void {
  const insert = db.prepare(
    `INSERT INTO tasks (title, description, status, priority, notes, parent_id, created_at, updated_at)
     VALUES (@title, @description, @status, @priority, @notes, @parentId, @createdAt, @createdAt)`,
  );

  db.transaction(() => {
    for (const task of DEMO_TASKS) {
      const createdAt = new Date(now.getTime() - task.ageDays * DAY_MS).toISOString();
      const { lastInsertRowid } = insert.run({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        notes: task.notes ?? "",
        parentId: null,
        createdAt,
      });
      for (const subtask of task.subtasks ?? []) {
        insert.run({
          ...subtask,
          description: "",
          notes: "",
          parentId: Number(lastInsertRowid),
          createdAt,
        });
      }
    }
  })();
}
