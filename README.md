# DevLog

A small task tracker for engineering teams with four AI agents built in. They plan the day, break tasks down, write
Slack status updates and turn meeting notes into tracker changes.

The tracker itself is deliberately plain. The work went into making each AI feature a real agent: it calls tools,
decides what to do next from what it finds, and has its output validated before anything reaches the UI.

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [AI agents](#ai-agents): [shared runtime](#shared-agent-runtime), [A · Plan my day](#a--plan-my-day-prioritization),
  [B · Break down](#b--break-down-with-ai-decomposition), [C · Status update](#c--status-update-for-slack),
  [D · AI inbox](#d--ai-inbox-own-idea)
- [Рішення і компроміси](#рішення-і-компроміси)
- [How this was built](#how-this-was-built) (see [AGENT_LOG.md](AGENT_LOG.md))

---

## Quick start

Requires **Node.js 22.12+** (`node -v`). There's an `.nvmrc`, so `nvm use` works.

```bash
git clone <repo-url> devlog && cd devlog
npm install
npm run dev
```

Open http://localhost:3000. **No other setup is needed**: no database server, no migrations to run, no key.

- **Database:** created automatically on first start (`data/devlog.db`) and filled with demo tasks of different ages
  and states, so every agent has something to reason about right away.
- **AI:** without a key the agents run in **mock mode** (see [below](#mock-mode)), and the UI labels it. For real
  agents:

  ```bash
  cp .env.example .env.local     # then set OPENAI_API_KEY=sk-...
  # restart npm run dev; env files are read at startup
  ```

| Variable         | Required | Default            | Purpose                                                          |
| ---------------- | -------- | ------------------ | ---------------------------------------------------------------- |
| `OPENAI_API_KEY` | no       | —                  | Real LLM for all four agents. Empty = mock mode.                 |
| `OPENAI_MODEL`   | no       | `gpt-4o-mini`      | Any OpenAI chat model with tool calling.                         |
| `DATABASE_PATH`  | no       | `./data/devlog.db` | SQLite file. Created on first start.                             |

| Script              | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run dev`       | Dev server                                                                |
| `npm test`          | Unit + agent tests (Vitest, in-memory SQLite, scripted model — no network) |
| `npm run typecheck` | `next typegen` + `tsc`                                                    |
| `npm run lint`      | ESLint                                                                    |
| `npm run build`     | Production build                                                          |
| `npm run db:reset`  | Delete the local database; it is recreated with demo data on the next start |

### The database

A single SQLite file, `data/devlog.db`, sits next to two WAL files (`-wal`, `-shm`). The whole `data/` folder is
git-ignored, so every clone starts from the same demo data.

| Situation | What happens |
| --- | --- |
| No database file (fresh clone) | Created, migrated and seeded with demo tasks on the first request. |
| Empty or older-schema file | Migrated in place (`PRAGMA user_version`). Not seeded, so you'll see the empty state. |
| Every task deleted | The board shows an empty state with *New task* and *AI inbox*; *Plan my day* answers "nothing to plan" without calling the model. |
| You want the demo data back | Stop the dev server, `npm run db:reset`, start again. |

To look inside:

```bash
sqlite3 -header -column data/devlog.db "select id, title, status, priority, parent_id from tasks;"   # sqlite3 ships with macOS
```

…or open `data/devlog.db` in a GUI: [DB Browser for SQLite](https://sqlitebrowser.org/)
(`brew install --cask db-browser-for-sqlite`), TablePlus, or the "SQLite Viewer" extension in VS Code / Cursor.
Read freely, but make changes through the app: the dev server holds the database open.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` fails building `better-sqlite3` / "engine" warning | Node is older than 22.12. Run `nvm install 22 && nvm use`, delete `node_modules`, install again. |
| `Another next dev server is already running` | Next 16 allows one dev server per folder. Stop the other one, or open the URL it prints. |
| Port 3000 is busy | `npm run dev -- -p 3001` |
| Agents still say "Mock agent" after adding a key | The key must be in `.env.local` (not `.env.example`). Restart `npm run dev`. |
| Agent request fails with "could not be reached" | Check the key, the model name and your network. The UI shows how far the agent got. |
| Odd server errors right after pulling new code | Restart `npm run dev`. A long-running dev server can keep stale server modules. |

---

## Architecture

```
Browser (React client components)
  │  fetch JSON
  ▼
Next.js route handlers ── app/api/**
  │                         │
  │  CRUD                   │  agents
  ▼                         ▼
TaskRepository        Agent runtime (lib/agents/runtime.ts)
lib/tasks/*             │   tool loop · step limit · output validation
  │                     ├── tools ──► TaskRepository (read-only)
  ▼                     └── model ──► OpenAI  |  scripted mock
SQLite (better-sqlite3)
```

- **One Next.js app**: the UI and the REST API (route handlers) run in one process. There is no separate Express server.
- **`lib/tasks/`** is the domain layer. `types.ts` holds the zod-free types and constants that the client can import,
  `schema.ts` holds zod schemas for every input, `repository.ts` does all SQL, and `search.ts` is a keyword search
  used by agents.
- **`lib/agents/`** has the shared runtime, the model adapters (OpenAI and scripted) and one file per agent.
  Agents read through the repository, and **none of them writes to the database**. Writes happen only through
  normal endpoints, after the user confirms.
- **UI**: `components/task-board.tsx` is the page. Filter, sort and the open task live in the URL
  (`?status=todo&sort=priority&order=desc&task=7`), so a view survives reloads and can be shared. AI features live
  in `components/agents/`. The UI primitives (shadcn on Base UI) and theme tokens come from my previous project.

### Data model

A single `tasks` table: `id, title, description, status, priority, notes, parent_id, created_at, updated_at`.

- **Subtasks** are rows with `parent_id`, one level deep. The repository enforces the depth (422 otherwise), and
  deleting a parent cascades to its subtasks.
- **`notes`** are free-form progress notes ("tried X, waiting on Y"). The status-update agent reads them, and the
  inbox agent appends to them.
- Migrations are an ordered list of SQL statements, tracked with SQLite's `user_version`.

### REST API

| Method & path                     | Body / query                                            | Notes                                  |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `GET /api/tasks`                  | `?status=todo\|in-progress\|done&sort=priority\|createdAt&order=asc\|desc` | Top-level tasks + subtask progress |
| `POST /api/tasks`                 | `{title, description?, status?, priority?, notes?, parentId?}` | 201                             |
| `GET /api/tasks/:id`              |                                                         | Task with subtasks                     |
| `PATCH /api/tasks/:id`            | any subset of the fields                                | Empty patch → 400                      |
| `DELETE /api/tasks/:id`           |                                                         | 204, cascades to subtasks              |
| `POST /api/tasks/:id/subtasks`    | `{subtasks: [{title, description?, priority?}]}`        | Atomic bulk create (agent B confirm)   |
| `POST /api/inbox/apply`           | `{changes: [create \| update]}`                         | Atomic apply (agent D confirm)         |
| `POST /api/agents/prioritize`     | `{context?}`                                            | Agent A                                |
| `POST /api/agents/decompose`      | `{taskId, answers?}`                                    | Agent B                                |
| `POST /api/agents/status-update`  | `{taskId, audience, note?}`                             | Agent C                                |
| `POST /api/agents/inbox`          | `{text}`                                                | Agent D                                |

Errors have one shape: `{ error: { code, message, issues? } }`, with 400 for validation, 404 for an unknown task,
422 for an invalid parent and 500 for anything unexpected. Agent errors add the partial `trace` and use 503 when the
model is unreachable and 502 when the agent ran out of steps or kept producing invalid output.

---

## AI agents

### Shared agent runtime

All four agents run on the same loop (`lib/agents/runtime.ts`, about 230 lines, covered by `runtime.test.ts`):

```
messages = [system, user]
repeat up to maxSteps:
  response = model(messages, tools)          # tool_choice: "required"
  for each tool call:
    finish tool?  → validate output (zod schema + semantic check)
                     ok      → return result + trace
                     invalid → send the problems back as the tool result ("repair turn"); give up after maxRepairs
    normal tool?  → validate args with zod → run → send JSON result back (errors go back too, not thrown)
step limit hit → AgentError("step_limit") with the trace so far
```

Design choices that apply to every agent:

- **An agent can only stop through a finish tool.** `tool_choice: "required"` means the model can't finish with
  free text, so every answer is structured. If it still replies in prose, the runtime tells it to call a tool.
- **Two layers of validation.** The zod schema checks shape and limits. A per-agent `check()` checks facts against
  the database (for example, that the task ids exist and are open, or that a quote really appears in the input).
  Failures are returned to the model so it can fix them. That correction step is part of what makes this an agent
  rather than a single prompt.
- **Tool errors are data, not exceptions.** Bad arguments, an unknown tool or a missing task come back to the model
  as `{error}` and it continues.
- **Trace.** Every tool call is recorded with a one-line summary and shown in the UI under *How the agent got here*.
  That shows the user which tasks the agent actually read before answering.
- **Read-only tools.** Agents propose and the user confirms. That is the main defence against a wrong answer.

#### Mock mode

Without `OPENAI_API_KEY`, `createModel()` returns a **scripted model**: a small deterministic policy per agent that
calls the same tools through the same runtime and returns the same output types. It ranks with a formula,
decomposes from keyword templates and extracts action items with regexes. Mock mode exercises the real loop,
validation, API and UI, but it doesn't understand the tasks, and it says so in its summary and in the UI badge.
All four agents work with a real key. Mock mode is the offline and CI fallback, not a replacement.

---

### A · Plan my day (prioritization)

*Header → **Plan my day**.* Optional free-text context ("3 focused hours, on-call after lunch").

| | |
|---|---|
| **Tools** | `get_board_overview`: all open tasks as compact briefs (priority, status, age in days, days since update, subtask progress) plus computed signals (stale in-progress, old todos, high priority not started). `list_tasks(status)`. `get_task(id)`: description, notes, subtasks. |
| **Steps** | Overview → reads at least 2 candidates in full (notes often change the picture, e.g. "waiting on security review") → `finish_plan`. |
| **Decision rules** (prompt) | Finish before starting (limit WIP). A stale in-progress task can beat a fresh high-priority one. Blocked → action `unblock`, not `continue`. Vague tasks don't go in focus. Old tasks are flagged, not ignored. Respect the user's context. |
| **Stops when** | `finish_plan` passes validation, or after 8 steps. |
| **Output** | `{summary, focus: [{taskId, action: finish\|continue\|unblock\|start, reason}] (1–3), later: [{taskId, reason}] (≤5), warnings[]}` |
| **Validation** | zod plus a check that every `taskId` is an **open top-level** task and none appears twice. After the run, a deterministic guardrail lists board signals the plan didn't mention (see below). |

**Failure case: the model drops tasks silently.** With `gpt-4o-mini` the plan was good. It picked `unblock` for the
auth migration because its notes say it's waiting on a security review, which mock mode can't see. But it left the
high-priority memory-leak task (not started) and three tasks older than 14 days out of *focus*, *later* and
*warnings* alike. A prompt can ask for completeness but can't guarantee it, so after the agent finishes,
`uncoveredSignals()` lists every stale, old or high-priority-not-started task the plan never mentions. The UI shows
these as **"Not mentioned by the agent · flagged by DevLog"**, so the user can tell the model's reasoning apart from
the system's checks.

**Failure case: an invented id.** If the model returns an id it never saw (or a done task), `check()` rejects the
answer and the model gets *"task 42 is not an open top-level task"*. After two failed repairs the request fails
with 502. The UI shows the error with the trace and a retry option. It never shows a plan that points at a
non-existent task.

---

### B · Break down with AI (decomposition)

*Task dialog → **Suggest subtasks**.*

| | |
|---|---|
| **Tools** | `get_task(id)`; `search_tasks(query)`: finds related work elsewhere on the board, so the agent doesn't duplicate it. |
| **Finish tools** | `ask_clarification({reason, questions: [{question, options[]}] 1–3})` **or** `propose_subtasks({approach, subtasks: [{title, description, priority}] 2–8, assumptions[]})` |
| **Steps** | Read the task → search the board → decide: is it too vague to split well? If yes, ask. If no, propose. |
| **Clarification loop** | Asking ends the run. The UI shows the questions with clickable suggested answers, and the user's answers start a **new run** with the answers in the prompt. On that run `ask_clarification` **is not offered at all**, so the agent cannot ask a second round. The limit is enforced in code, not left to the model. The server keeps no session: the client sends the answers back. |
| **Validation** | zod (2–8 items, verb-first titles), plus a check that no title duplicates an existing subtask or another proposed item. |
| **Writes** | None. The user unchecks, renames or re-prioritizes items, then **Create N subtasks** calls the normal bulk endpoint in one transaction. |

**Failure case: suggested answers that don't exist.** For "Improve performance · The app feels slow" the agent
correctly asked what's slow and what the target is. But it offered options like "Home page" and "Profile page" for
an app it knows nothing about. The options are only shortcuts: every question also has a free-text field, and the
second run treats the typed answer as fact. Unanswered questions become `assumptions` in the proposal, so you can
see what the agent guessed.

**Failure case: generic plans.** For a task that is clear but unusual, the agent can fall back on a template-like
"analyze → implement → test → deploy" plan. The `approach` sentence and per-item descriptions make that visible,
and nothing is saved until you edit and confirm.

---

### C · Status update for Slack

*Task dialog → **Status update for Slack**.* Audience: Team / Manager / Stakeholders, plus an optional "What's new?"
note.

| | |
|---|---|
| **Tools** | `get_task(id)`; `assess_progress(id)`: computed signals such as subtask completion, days since update, stale flag, a blocker hint found in notes ("waiting", "review", "blocked"…), and whether the author just added a fresh note. |
| **Steps** | Read → assess → choose the tone from the facts → `finish_update`. The model often makes both reads in one turn. |
| **Output** | `{tone: shipped\|on-track\|heads-up\|blocked, message, blockers[], askForHelp}` |
| **Validation** | zod (message ≤ 900 chars), plus checks: `shipped` only if the task is actually done; `blocked` must name at least one blocker; any `#123` in the message must be a real task. |
| **Post-processing** | Markdown → Slack mrkdwn (`**bold**` → `*bold*`, headings, bullets) is done deterministically. The model kept emitting `**`, and code handles that more reliably than more prompting. |
| **Writes** | None. The text is editable before **Copy for Slack**. |

**Failure case: tone that contradicts the news.** The first version computed "stale" only from `updated_at`. With a
fresh note ("Found it: the mock server starts after the iframe, fix in review"), the model still wrote *"stale for
6 days"* in a heads-up tone. Fix: an author note now counts as fresh progress (`freshNoteFromAuthor`), and the
prompt says the note overrides older signals. A mock-mode test covers it.

**Failure case: jargon for stakeholders.** The Stakeholders audience still got "Docker image" and "crypto calls".
The audience instruction now explicitly bans tool and technology names. This is the weakest guarantee of the four:
it is enforced only by the prompt. The UI's answer is that the message is always an editable draft.

---

### D · AI inbox (own idea)

*Header → **AI inbox**.* Paste meeting notes, a Slack thread, a bug report or PR comments. There is an example
button.

**Why it matters for an engineering team.** Most tasks aren't born in the tracker. They come up in stand-ups,
threads and incident channels, and moving them into the tracker is boring manual work. So they get lost ("someone
said they'd look at the leak") or duplicated ("we already had a ticket for that"). Lost and duplicated tasks are
exactly the friction this product is meant to remove. Deciding whether an item is new work, news about existing
work or noise requires checking each item against the board, so it needs an agent: a single prompt can't look things
up. The idea grew out of the "plan a goal from free text" feature of my previous project, adapted to team work.

| | |
|---|---|
| **Tools** | `search_tasks(query)`: covers subtasks and done tasks too; `get_task(id)`. |
| **Steps** | Extract action items → **one search per item** (in parallel within a turn) → read promising matches → `finish_triage`. The typical run is 3 turns with about 9 tool calls. |
| **Per item** | `create` (new task), `update` (append a dated note to an existing task, optionally change its priority) or `skip` (already covered, done or not actionable), always with a `reason`. |
| **Output** | `{summary, items: [{action, sourceQuote, title, description, priority, taskId, note, reason}] ≤12}` |
| **Validation (hard)** | `sourceQuote` must be a **verbatim fragment of the input**, which rules out invented action items. `update`/`skip` must point at an existing task. A task is updated at most once. A `create` whose title matches an existing task **or subtask** is rejected with *"already exists as subtask of #2 #5, use update or skip"*. |
| **Validation (soft)** | An `update` that shares no keywords with the task it points at is marked **Weak match**, starts unchecked, and offers "Create as a new task instead". |
| **Writes** | Only selected rows, through `POST /api/inbox/apply`, in **one transaction**. Notes are prefixed `[YYYY-MM-DD, from inbox]`. |

**Failure case: a duplicate of a subtask.** On the first real run, the agent turned "load test on staging is next"
into a **new task**, even though *Run load test on staging* already existed as a subtask of the auth migration. Its
search had used the wrong terms. Two fixes: the prompt now requires one search per item with that item's own terms,
and the duplicate-title check rejects the answer, so the model has to choose `update`. On the next run it updated
subtask #5 instead.

**Failure case: a plausible but wrong match.** "Add an alert when checkout error rate goes above 2%" was linked
once to *Rate limiting for public API* and once to *Fix flaky checkout e2e test*. Both share a word with it ("rate",
"checkout"), so the keyword-overlap warning doesn't fire. A test in `agents.test.ts` documents this limit. Here the
human review is the real safeguard. Each row shows the quote, the target task and the agent's reason side by side,
and one click turns a wrong update into a new task.

**Failure case: inconsistent runs.** The same notes produced `update #10` (memory leak, urgency raised) on one run
and `skip #10` ("already covered") on another, although the text adds real news ("hitting prod customers in EU").
I accept this: the result is a proposal, skips are shown with their reason, and nothing is applied without review.

---

## Рішення і компроміси

<!--
  This section is written by hand, without AI assistants — as the task requires.
  Facts to cover are listed in docs/agent-log-notes.md → "Decisions log".
-->

_TODO (автор): написати самостійно._

---

## How this was built

The UI, API and agents were built together with Claude Code. The process is described in
[AGENT_LOG.md](AGENT_LOG.md): which prompts I used, where the agent got things wrong, and what I didn't delegate.
The original plan is in [`docs/plans/`](docs/plans/2026-11-24-devlog-roadmap.md).

### Project layout

```
app/
  page.tsx                     board page (client component inside Suspense)
  api/tasks/…                  CRUD + bulk subtasks
  api/agents/{prioritize,decompose,status-update,inbox}/route.ts
  api/inbox/apply/route.ts
components/
  task-board.tsx               page shell, URL state, dialogs
  tasks/                       row, toolbar, create/detail/delete dialogs, badges, selects
  agents/                      plan-day, decompose, status-update, inbox UIs + shared trace/badge
  ui/                          shadcn/Base UI primitives
lib/
  db/                          connection, migrations, demo seed
  tasks/                       types, zod schemas, repository, search
  agents/                      runtime, models (OpenAI/scripted), one file per agent, HTTP helpers
```
