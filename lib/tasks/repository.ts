import type { Db } from "@/lib/db";
import type {
  SubtaskDraft,
  Task,
  TaskCreate,
  TaskListQuery,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  TaskUpdate,
  TaskWithSubtasks,
} from "@/lib/tasks/schema";

interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes: string;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

interface TaskSummaryRow extends TaskRow {
  subtask_count: number;
  subtask_done_count: number;
}

export class TaskNotFoundError extends Error {
  constructor(readonly taskId: number) {
    super(`Task ${taskId} not found`);
    this.name = "TaskNotFoundError";
  }
}

/** Subtasks are one level deep: a subtask cannot have its own subtasks. */
export class InvalidParentError extends Error {
  constructor(readonly parentId: number) {
    super(`Task ${parentId} is a subtask and cannot have subtasks`);
    this.name = "InvalidParentError";
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    notes: row.notes,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PRIORITY_RANK_SQL = `CASE t.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

const COLUMN_BY_FIELD: Record<keyof TaskUpdate, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  notes: "notes",
};

export class TaskRepository {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Top-level tasks with subtask progress, filtered and sorted. */
  list(query: TaskListQuery): TaskSummary[] {
    const direction = query.order === "asc" ? "ASC" : "DESC";
    const orderBy =
      query.sort === "priority"
        ? `${PRIORITY_RANK_SQL} ${direction}, t.created_at DESC, t.id DESC`
        : `t.created_at ${direction}, t.id ${direction}`;

    const rows = this.db
      .prepare(
        `SELECT t.*,
                (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
                (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtask_done_count
           FROM tasks t
          WHERE t.parent_id IS NULL
            AND (@status IS NULL OR t.status = @status)
          ORDER BY ${orderBy}`,
      )
      .all({ status: query.status ?? null }) as TaskSummaryRow[];

    return rows.map((row) => ({
      ...toTask(row),
      subtaskCount: row.subtask_count,
      subtaskDoneCount: row.subtask_done_count,
    }));
  }

  findById(id: number): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  getById(id: number): Task {
    const task = this.findById(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }

  getWithSubtasks(id: number): TaskWithSubtasks {
    return { ...this.getById(id), subtasks: this.listSubtasks(id) };
  }

  listSubtasks(parentId: number): Task[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE parent_id = ? ORDER BY id ASC`)
      .all(parentId) as TaskRow[];
    return rows.map(toTask);
  }

  create(input: TaskCreate): Task {
    if (input.parentId !== null) this.assertCanHaveSubtasks(input.parentId);
    const timestamp = this.now().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO tasks (title, description, status, priority, notes, parent_id, created_at, updated_at)
         VALUES (@title, @description, @status, @priority, @notes, @parentId, @timestamp, @timestamp)`,
      )
      .run({ ...input, timestamp });
    return this.getById(Number(result.lastInsertRowid));
  }

  /** Creates several subtasks atomically — either all of them are saved or none. */
  createSubtasks(parentId: number, drafts: SubtaskDraft[]): Task[] {
    return this.db.transaction(() => {
      this.assertCanHaveSubtasks(parentId);
      return drafts.map((draft) =>
        this.create({ ...draft, status: "todo", notes: "", parentId }),
      );
    })();
  }

  update(id: number, changes: TaskUpdate): Task {
    this.getById(id);
    const fields = (Object.keys(changes) as (keyof TaskUpdate)[]).filter(
      (field) => changes[field] !== undefined,
    );
    if (fields.length === 0) return this.getById(id);

    const assignments = fields.map((field) => `${COLUMN_BY_FIELD[field]} = @${field}`);
    this.db
      .prepare(
        `UPDATE tasks SET ${assignments.join(", ")}, updated_at = @updatedAt WHERE id = @id`,
      )
      .run({ ...changes, id, updatedAt: this.now().toISOString() });
    return this.getById(id);
  }

  /** Deletes a task; its subtasks go with it (ON DELETE CASCADE). */
  delete(id: number): void {
    const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    if (result.changes === 0) throw new TaskNotFoundError(id);
  }

  private assertCanHaveSubtasks(parentId: number): void {
    const parent = this.getById(parentId);
    if (parent.parentId !== null) throw new InvalidParentError(parentId);
  }
}
