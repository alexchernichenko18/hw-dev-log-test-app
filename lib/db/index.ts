import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { seedDemoTasks } from "@/lib/db/seed";

export type Db = Database.Database;

const MIGRATIONS: string[] = [
  `CREATE TABLE tasks (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     title       TEXT    NOT NULL,
     description TEXT    NOT NULL DEFAULT '',
     status      TEXT    NOT NULL CHECK (status IN ('todo', 'in-progress', 'done')),
     priority    TEXT    NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
     notes       TEXT    NOT NULL DEFAULT '',
     parent_id   INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
     created_at  TEXT    NOT NULL,
     updated_at  TEXT    NOT NULL
   );
   CREATE INDEX tasks_parent_id ON tasks(parent_id);`,
];

/** Applies pending migrations, tracked through SQLite's built-in user_version. */
export function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function openDatabase(file: string): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function resolveDatabasePath(): string {
  // Runtime data, not source: tell Turbopack not to trace the project directory for it.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH ?? "./data/devlog.db");
}

// Next.js dev mode re-evaluates modules on every change; keep one connection per process.
const globalForDb = globalThis as unknown as { devlogDb?: Db };

export function getDb(): Db {
  if (!globalForDb.devlogDb) {
    const file = resolveDatabasePath();
    const isNew = !fs.existsSync(file);
    const db = openDatabase(file);
    if (isNew) seedDemoTasks(db);
    globalForDb.devlogDb = db;
  }
  return globalForDb.devlogDb;
}
