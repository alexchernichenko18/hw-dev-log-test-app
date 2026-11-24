# AGENT_LOG

How DevLog was built with a coding agent: what I asked it for, where it went wrong, and what I kept for myself.
Raw notes taken during the work are in [`docs/agent-log-notes.md`](docs/agent-log-notes.md). The full chat is
exported to [`docs/agent-chat-export.md`](docs/agent-chat-export.md).

## Tools

| Tool | Used for |
|---|---|
| **Claude Code** (CLI, Claude Opus) | Practically all code: scaffolding, the UI, the API, the agent runtime, the four agents, tests, the README draft. One long session. |
| **`superpowers` plugin** for Claude Code | Planning discipline: plan first, then execute step by step and verify before claiming something is done. |
| **Headless Chrome + `puppeteer-core`** (driven by the agent, from a scratch directory outside the repo) | Visual checks: the agent took screenshots of the board, dialogs and agent flows (clicking through clarification → proposal → create) and in light/dark/mobile layouts. I tried to connect the Claude in Chrome extension mid-session, but browser tools only attach when a session starts, so the agent kept using screenshots. |
| **My previous project (todo-ai)** | Source of UI primitives, theme tokens, dialog patterns and the "real model + mock fallback + server-side validation" AI layering. |

## How the work was split

1. **Parse the old project.** I asked the agent to read `todo-ai` first and say what can be reused. It produced a
   borrow / don't-borrow table. Key finding: todo-ai's AI is one structured-output call per feature, not an agent,
   so it couldn't be reused as is. Only the layering around it was reused.
2. **Plan.** The agent wrote [a roadmap](docs/plans/2026-11-24-devlog-roadmap.md) and asked me four questions it
   couldn't answer from the code: LLM provider, storage, which AI features, language. I answered them (see
   [What I did not delegate](#what-i-did-not-delegate)).
3. **Execute.** After step 1 I told it to stop asking between steps. It then went through storage + API → tracker
   UI → agent runtime → agents A, B, C, D → hardening → docs, committing after each step. I joined in to run the app
   locally, add the API key and react to what I saw.

## Key prompts

Original prompts were in Ukrainian; they are shortened and translated below. The [full export](docs/agent-chat-export.md) has the verbatim text.

1. **Kick-off.**
   > "On the desktop there's todo-ai, my diploma project. We can take most things from it: UI, ideas, functions, AI keys.
   > Now we're doing a test task: [full task statement pasted]. I already set up Next.js, so the backend will be Next.js API routes to move faster.
   > Every point of the task is important. Make a step-by-step plan, but first, as a separate step, parse my project so it's clear what we can borrow.
   > If you have questions, ask. The task must be done excellently."

2. **Pushback on scope.**
   > "Why can't you write the README yourself? And come up with D yourself, based on my previous project and the context of the task."

   The agent explained that the task explicitly requires the "Рішення і компроміси" section to be written without AI.
   It offered to write everything else and keep a factual list of decisions for me. For D it proposed *AI inbox* and
   derived it from todo-ai's "plan a goal from free text" feature.

3. **Autonomy.**
   > "You don't have to ask me between steps, do everything yourself. If there's a question, ping me."

4. **Verification.**
   > "Let me run the app locally and you'll check everything through Claude in Chrome."

   (The extension didn't attach to the running session; see Tools.)

5. **The agent's own prompts to the in-product model** are the system prompts in `lib/agents/*.ts`. The interesting
   ones are the decision rules in `prioritize.ts` and the hard rules in `inbox-triage.ts`. Both were rewritten after
   real-model runs, described below.

## Where the agent was wrong (and how it was caught)

Each case below says who noticed the problem and what changed. Most were caught by verification steps the agent ran
itself (screenshots, live calls against the real model, a fresh clone). That says as much about *how* to work with an
agent as the mistakes do: the fixes came from checking the result, not from trusting the agent's report.

### 1. The inbox agent created a duplicate of an existing subtask

- **What happened:** In the first real run of agent D on sample meeting notes, "Load test on staging is next" became
  a *new task*, although *Run load test on staging* already existed as a subtask of #2. It also missed the news that
  unblocked #2 ("security approved") and linked "add an alert for checkout error rate" to *Rate limiting*.
- **How it was noticed:** We ran the agent on realistic notes and read each item against the board, instead of
  stopping at "the endpoint returns 200".
- **What changed:** I didn't want to fix this with prompt wording alone. Changes: (a) a hard check rejects a
  `create` whose title matches an existing task or subtask, so the model gets a repair turn; (b) the prompt asks for
  one search per item with that item's own terms; (c) a soft "weak match" flag with a one-click "create as new task
  instead". The second run updated subtask #5 correctly. The wrong "checkout alert" link still happens sometimes. A
  test (`sharedTerms … ["rate"]`) documents why the heuristic can't catch it, and the README says so instead of
  claiming it's solved.

### 2. The status-update agent contradicted the user's own news

- **What happened:** With a fresh note ("Found it, fix in review"), the generated Slack update still said *"stale for
  6 days"* in a heads-up tone. The `assess_progress` tool written by the coding agent computed staleness only from
  `updated_at`.
- **How it was noticed:** Four live scenarios against `gpt-4o-mini` (blocked / stakeholders / done / with note).
  The output read wrong to a human, although it was valid by every check.
- **What changed:** The author's note now counts as fresh progress (`freshNoteFromAuthor`), the prompt says the note
  overrides older signals, and a test covers it. The same runs showed the model writing `**bold**`, which Slack
  doesn't render. That is converted in code, not fixed with more prompting.

### 3. The planning agent silently dropped important tasks

- **What happened:** The real-model plan was good where it mattered: it chose `unblock` for the task waiting on
  security review, which mock mode can't do. But it didn't mention the high-priority memory-leak task at all.
- **What changed:** A deterministic `uncoveredSignals()` pass lists every stale, old or high-priority-not-started
  task the plan doesn't mention. The UI shows these separately as *"flagged by DevLog"*, so nobody mistakes them for
  the model's reasoning.

### 4. Smaller misses in generated code

- **Title styling silently overridden.** The agent gave the dialog title `text-lg`, but the shared `Input` has
  `md:text-sm`, which wins on desktop. It was caught on a screenshot.
- **"Created today ago"** in the task list. `formatAge()` returned "today", and the row added "ago". It was caught
  only when the light-theme screenshot happened to include newly created tasks. Now there's a test for it.
- **A wrong runtime requirement in the README.** The draft said Node 20+. Checking `engines` showed that
  `better-sqlite3` 13 needs Node 22+. Fixed in the README, `package.json` `engines` and `.nvmrc`.
- **zod in the client bundle.** Domain constants first lived in the zod schema module. They were moved to a zod-free
  `types.ts`.
- **A cast-heavy first agent runtime.** `AgentTool<never>` casts failed `tsc`. It was rewritten with type-erased
  `defineTool()` closures instead of casts.
- **A test that passed for the wrong reason** (caught while writing it): `warning.includes("#1")` matched "#10".
  Fixed with a word-boundary regex.

### 5. Environment incidents

- **`.env.example` was ignored by git** because of the template's `.env*` rule. The agent noticed this while
  verifying with `git check-ignore`. Without the fix the required file would not have been submitted.
- **The API key landed in the tracked `.env.example`** when I added it. The agent saw `M .env.example` in
  `git status`, moved the key to the git-ignored `.env.local`, restored the template, and checked that the key never
  entered git history. I wouldn't have wanted to find this after pushing.
- **A stale dev server.** My long-running `next dev` kept an old server module (`repo.listAll is not a function`)
  while the tests passed. A restart fixed it. Lesson: verify against a fresh process (the agent also ran a full
  `git clone → npm install → npm run dev` check in a temp directory).

## What I did not delegate

> **TODO (автор): переглянути і доповнити своїми словами — це особиста рефлексія.**

- **Product decisions.** The four questions the agent asked (OpenAI vs Anthropic, SQLite vs JSON, which AI features,
  English vs Ukrainian) were answered by me. These choices shape everything else, and I have to defend them in the
  interview, so they had to be mine.
- **The "Рішення і компроміси" section of the README.** The task requires writing it without AI. The agent only kept
  a factual list of decisions in `docs/agent-log-notes.md` so nothing would be forgotten. The text is mine.
- **Secrets.** The API key never went through the chat. I put it into the env file myself.
- **Final judgment on agent outputs.** The in-product agents are designed so that they never write to the database
  on their own: every change is confirmed by a person. I applied the same rule to the coding agent's work: commits
  were made per step so each one could be reviewed and reverted.

## Where I'd trust the agent, and where I wouldn't

> **TODO (автор): переглянути.**

- **Trust:** scaffolding UI from existing primitives, wiring CRUD, writing tests for clear contracts, finding
  inconsistencies by running things (screenshots, fresh clone, live calls).
- **Don't trust without checking:** claims that something "works", until it has been run; anything about the
  environment (versions, `engines`, `.gitignore`); prompt-only fixes for LLM behavior. In every case above, the fix
  that held was a check in code (a validator, guardrail or test), not a stronger prompt.
