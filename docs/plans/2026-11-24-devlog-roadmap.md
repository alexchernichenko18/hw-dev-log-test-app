# DevLog — roadmap

Decisions locked in (2026-11-24): OpenAI (function calling), SQLite via better-sqlite3,
Next.js API routes, AI features A (prioritization) + B (decomposition) + C (status update)
+ D (Inbox triage — own idea, see Step 7.5), everything in English.

Budget: ~9h. Each step ends with a commit and a short entry in `docs/agent-log-notes.md`
(raw material for AGENT_LOG.md: prompt, what the agent produced, what was fixed by hand).

---

## Step 0 — Parse todo-ai (DONE in this session)

What we take from `~/Desktop/todo-ai`:

| Take | From | How |
|---|---|---|
| shadcn/base-ui primitives (button, dialog, select, badge, tabs, textarea, alert-dialog, sonner, skeleton, tooltip…) | `components/ui/*`, `components.json`, `lib/utils.ts` | copy as is |
| Theme tokens (oklch, light/dark) + next-themes | `app/globals.css`, `components/theme-provider.tsx` | copy, adjust accent |
| Dialog/UX patterns: task form, delete confirm, empty state, subtask editor, task item | `components/task-form-dialog.tsx`, `delete-confirm-dialog.tsx`, `empty-state.tsx`, `subtask-editor.tsx`, `task-item.tsx` | adapt to new fields |
| AI layering: `provider` (real vs mock), client-side `AiError` + messages, server-side validation of LLM output, 400/502/503 status mapping | `lib/ai/provider.ts`, `client.ts`, `validate.ts`, `app/api/ai/*/route.ts` | reuse the idea, rewrite for agents |
| Strict JSON schema prompts with `response_format: json_schema` | `lib/ai/openai.ts` | reuse for the agents' final answer step |
| Test setup (Vitest unit + Playwright e2e) | `vitest.config.mts`, `playwright.config.ts` | copy config, keep tests small |

What we do NOT take:
- `localStorage` storage + reducer — DevLog persists on the server (SQLite).
- Single-call AI (`generateRecommendations`, `parseIntent`) — the ТЗ requires real multi-step agents.
- Learning-specific stuff: resources, takeaways, library, categories, drag-and-drop.
- AI keys — there is no `.env*` in todo-ai; a fresh key goes to `.env.local` (git-ignored).

Version note: my-app is on Next 16.4.6 with `cacheComponents` enabled; todo-ai is on 16.2.6.
Read `node_modules/next/dist/docs/` before writing route handlers (AGENTS.md rule).

---

## Step 1 — Foundation (~1h)

- Remove experimental flags from `next.config.ts` that we don't need; add `serverExternalPackages: ["better-sqlite3"]` if required.
- Install: `better-sqlite3`, `openai`, `zod`, `lucide-react`, `next-themes`, `sonner`, `@base-ui/react`, `clsx`, `tailwind-merge`, `class-variance-authority`; dev: `vitest`, `@types/better-sqlite3`.
- Copy UI primitives + theme from todo-ai.
- `.env.example` (`OPENAI_API_KEY=`, `OPENAI_MODEL=gpt-4o-mini`, `DATABASE_PATH=./data/devlog.db`), `.gitignore` for `data/`, `.env.local`.
- Verify: `npm install && npm run dev` from a clean clone.

## Step 2 — Data layer + REST API (~1.5h)

- `lib/db.ts`: open DB, create schema on start (idempotent migration), WAL mode.
- Schema `tasks`: `id, title, description, status (todo|in-progress|done), priority (low|medium|high), created_at, updated_at, parent_id NULL → tasks.id ON DELETE CASCADE, notes TEXT` (notes feed agent C).
- `lib/tasks/schema.ts`: zod schemas (create/update) — single source of truth for API + agent tools.
- `lib/tasks/repository.ts`: list(filter status, sort priority|createdAt, dir), get, create, update, delete, listSubtasks.
- Routes: `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/[id]`. Validation → 400 with field errors, 404 for missing.
- Seed script (`npm run seed`) with ~10 realistic engineering tasks of different ages — needed to demo agent A.
- Unit tests for repository (in-memory DB).

## Step 3 — Tracker UI, scaffolded by the coding agent (~1.5h)

- Layout: header (DevLog, theme toggle), toolbar (status filter tabs: all/todo/in-progress/done; sort select: priority/date, asc/desc), task list, "New task" button.
- Task row: title, priority badge, status select inline, age ("3d ago"), subtask progress.
- Task detail sheet/dialog: edit all fields, notes, subtasks list, AI actions (decompose, status update).
- Create/edit dialog, delete confirmation, empty states, loading skeletons, toasts on errors.
- Filter/sort state lives in URL search params (shareable, survives reload).
- Data fetching: small `lib/api-client.ts` + optimistic update for status change.
- Log in notes: exact scaffold prompt, what was generated, what was rewritten.

## Step 4 — Agent runtime (~1h)

- `lib/agents/runtime.ts`: generic loop on OpenAI chat completions with `tools`:
  call model → execute tool calls → append results → repeat until model calls a `finish_*` tool or `MAX_STEPS` (e.g. 6) is hit.
- Every tool: zod-validated input, typed handler, result serialized to JSON.
- Final output: `finish_*` tool args validated with zod; on failure — one repair turn ("your output failed validation: …"), then give up with a typed error.
- Returns `{ result, trace: [{step, tool, args, summary}] }` — trace is shown in the UI ("How the agent got here"), proves it's multi-step.
- Mock mode when `OPENAI_API_KEY` is missing: deterministic scripted agents with the same output shape; clearly labeled in UI and README.
- Timeouts + error mapping (503 upstream, 502 invalid output).

## Step 5 — Agent A: Prioritize my day (~1h)

- Tools: `list_tasks(status?)`, `get_task(id)` (with subtasks + notes), `get_task_stats()` (age in days, counts by status, stale in-progress), `finish_plan`.
- Decision hints in system prompt: in-progress before starting new work (WIP), high priority, age/staleness, nearly-done parents, avoid > 3 focus items.
- Output: `{ focus: [{taskId, reason}], later: [{taskId, reason}], summary }`; validate every `taskId` exists and isn't `done` — drop/flag hallucinated ids.
- UI: "Plan my day" panel with ordered list, reasons, trace, click → opens task.
- Edge cases: empty list → agent not called; all done → message.

## Step 6 — Agent B: Decompose task (~1.5h)

- Tools: `get_task(id)`, `list_tasks()` (to avoid duplicates of existing work), `ask_clarification(questions[])` (terminal — pauses the agent), `propose_subtasks` (terminal).
- Flow: vague task → agent returns 1–3 questions → user answers in UI → agent resumes with answers in context → proposal.
- Output: `subtasks: [{title, description, priority}]` 2–8 items, zod-validated, dedupe by title.
- Nothing is written without confirmation: user edits/unchecks items → `POST /api/tasks/[id]/subtasks` creates the selected ones.
- Stateless resume: client sends back the clarification Q&A (no server-side session store — mention trade-off).

## Step 7 — Agent C: Status update (~1h)

- Tools: `get_task(id)`, `list_subtasks(id)`, `get_notes(id)`, `finish_update`.
- Agent infers tone from context (blocked/overdue → direct, asks for help; done → short win; in progress → progress + next) and audience param (team / manager).
- Output: `{ tone, message, highlights[], blockers[] }`; validate message length (< ~600 chars), Slack mrkdwn.
- UI: generate, edit in textarea, copy to clipboard, regenerate with different audience.

## Step 7.5 — Agent D: Inbox triage (own idea, ~1.5h)

Grown out of todo-ai's "Plan a goal" (free text → structured task), adapted to an engineering team.
User pastes raw text — meeting notes, a Slack thread, a bug report, a PR review — and the agent
turns it into tracker changes.

- Tools: `search_tasks(query)` (keyword match over title/description), `get_task(id)`, `finish_triage`.
- Flow: extract action items → for each one search existing tasks → decide per item:
  `create` (new task with priority + reason), `update` (append note / bump priority of an existing task),
  or `skip` (duplicate / not actionable, with reason).
- Output: `{ items: [{action, taskId?, title, description, priority, note?, reason, sourceQuote}] }`;
  validate: `update` must reference an existing task id, `sourceQuote` must be a substring of the input
  (guards against invented action items).
- UI: "Inbox" dialog → paste → review table with per-item checkbox + editable fields → apply selected.
  Nothing is written without confirmation.
- Why it matters (README paragraph): most engineering tasks are born outside the tracker — in meetings
  and chats — and get lost or duplicated because transferring them is manual and boring.

## Step 8 — Hardening & tests (~0.5h)

- Unit: zod schemas, repository, agent output validators, runtime loop with a fake model (tool-call sequence → finish; max-steps; invalid output repair).
- Manual pass of the whole flow with a real key; `npm run build` + `npm run lint` clean.

## Step 9 — Docs (~1h)

- README: run instructions, architecture diagram (UI → API routes → repository/SQLite; API → agent runtime → OpenAI + tools), agent design per agent (steps/tools, how it decides next, stop conditions, structured output, validation), 1–2 failure cases each + handling, mock mode, env vars.
- **"Рішення і компроміси" — written by you, without AI.** I only keep a factual list of decisions in `docs/agent-log-notes.md` so you don't forget anything; the text is yours.
- AGENT_LOG.md: tools used (Claude Code + superpowers), 3–5 key prompts, ≥2 real agent mistakes with how they were spotted and fixed, what was not delegated and why. Export of this chat from `~/.claude/projects/...`.
- Optional: Loom 3–5 min.

## Step 10 — Delivery

- Clean-clone check: `git clone && npm install && npm run dev` without `.env.local` (mock mode) and with a key.
- Push to GitHub (public or with access), send link.
