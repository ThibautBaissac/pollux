# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pollux is a local-first personal AI assistant PWA built with the Claude Agent SDK. Single-user, privacy-focused, dark UI inspired by Signal. SQLite database, no external services beyond the Anthropic API.

## Commands

```bash
npm run dev       # Next.js dev server on :3000 (auto-runs migrations)
npm run build     # Production build
npm start         # Production server (auto-runs migrations)
npm run lint      # ESLint
npm test          # Vitest run
npm run test:watch
npm run coverage  # V8 coverage report + coverage/index.html
```

Run a single test file:
```bash
npx vitest run tests/memory.test.ts
```

Run a single test by name:
```bash
npx vitest run -t "test name pattern"
```

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5
- **Styling:** Tailwind CSS 4 via PostCSS, `@tailwindcss/typography` for markdown prose
- **Database:** SQLite (better-sqlite3, WAL mode) with Drizzle ORM
- **Agent:** `@anthropic-ai/claude-agent-sdk` — user-selectable model (Opus 4.6, Sonnet 4.6, Haiku 4.5)
- **Auth:** Cookie-based sessions, scrypt password hashing, single-user, recovery codes for offline password reset
- **Streaming:** Server-Sent Events (SSE) via ReadableStream
- **Testing:** Vitest 4 with V8 coverage
- **Markdown:** react-markdown + remark-gfm + rehype-highlight

## Architecture

### Layers

- `src/app/api/` — Next.js route handlers:
  - `chat/` — Core SSE streaming endpoint
  - `conversations/` — CRUD + search
  - `auth/` — Login, setup, password/email change, recovery, sessions
  - `memory/` — GET/PUT memory files (profile, knowledge, soul)
  - `reminders/` — CRUD for scheduled reminders
  - `notifications/` — Execution log (reminder fires, dream runs) + read-state
  - `dream/run` — Manual trigger for Dream memory consolidation
  - `settings/` — Model selection, working directory, MCP server configuration
  - `skills/` — CRUD for procedural skills and reads of supporting files
- `src/lib/` — Server-side logic:
  - `agent.ts` — SDK config, system prompt, tool list, subagent definitions
  - `chat.ts` — Shared chat primitives: conversation resolution, message persistence, used by both `/api/chat` and `scheduled-agent.ts`
  - `slash-commands.ts` — In-chat commands (`/new`, `/stop`, `/status`, `/dream`) parsed client-side
  - `auth.ts` / `auth-guard.ts` — Password hashing, sessions, route protection
  - `memory.ts` — Three memory files (profile, knowledge, soul) at `data/memory/`, history log for Dream
  - `dream.ts` / `dream-config.ts` — Automated memory extraction (Phase 1: summarize conversations → history.jsonl, Phase 2: analyze + edit memory files)
  - `git-memory.ts` — Git commits for memory file changes
  - `model-store.ts` / `cwd-store.ts` / `mcp-store.ts` / `models.ts` — User settings persistence + model catalog
  - `reminder-tool.ts` — Built-in MCP server exposing reminder add/list/remove to the agent
  - `reminders.ts` — Reminder business logic (CRUD, cron parsing, scheduling, running-state tracking)
  - `skills.ts` — Skill CRUD business logic (gray-matter frontmatter, size caps, symlink rejection, diagnostics)
  - `skill-tool.ts` — Built-in MCP server exposing the skill tool (`list`, `view`, `view_file`, `create`, `update`, `delete`) to the agent
  - `skill-http.ts` — Shared HTTP error mapping for the `/api/skills` routes
  - `scheduled-agent.ts` — Runs agent-mode reminders autonomously (no user in the loop) and records executions
  - `executions.ts` — Log of fired reminders/dream runs; backs the notifications UI
  - `rate-limit.ts` / `rate-limit-config.ts` — Per-route request throttling
  - `request-guards.ts` — Shared validation helpers for route handlers
  - `db/` — Drizzle schema + SQLite connection with auto-migration
- `src/hooks/` — Client state:
  - `useChat` — Chat state machine (messages, optimistic updates, abort)
  - `useChatStream` — SSE stream parsing, tool use merging
  - `useConversations` — Sidebar conversation list
  - `useNotifications` — Execution polling for the notification bell
  - `useAutoScroll` — Scroll-to-bottom behavior
- `src/components/` — React components:
  - `chat/` — ChatView, MessageList, MessageBubble, ChatInput
  - `sidebar/` — Sidebar, ConversationItem
  - `notifications/` — NotificationBell, NotificationPanel
  - `settings/` — Model select, MCP editor, memory editor, reminders manager, working directory, auth forms
- `src/types/` — Shared TypeScript types (Message, Conversation, ToolUse, Reminder, Execution)

### Key patterns

- **No global state library.** State lives in hooks exposed via React context (`ChatStreamContext`).
- **SSE protocol:** Events are `init`, `delta`, `tool`, `done`, `error`. Text deltas accumulate in client state; assistant messages are persisted server-side on completion.
- **Optimistic updates:** User + empty assistant message added immediately. Rolled back if error occurs before first delta.
- **Session resume:** SDK session ID stored on conversation record. Resume attempted on follow-up messages; auto-clears and retries fresh if corrupted (up to 2 retries).
- **Tool-only frame merging:** Frames with only tool use (no text) are deferred and merged into the next text-containing frame to avoid empty message rows.
- **Dream system:** Background process runs every 10 minutes (also triggerable via `/dream` slash command or `POST /api/dream/run`). Phase 1 summarizes recent conversations into `history.jsonl`. Phase 2 (triggered by entry count or time threshold) uses the agent to analyze history and edit memory files, then commits changes via git.
- **MCP servers:** User-configured MCP servers (stdio/http/sse) are merged with the built-in `pollux-reminders` server and passed to the SDK on every chat request. Config stored in `data/mcp-servers.json`.
- **Slash commands:** `/new`, `/stop`, `/status`, `/dream`, `/skills` are parsed in `ChatInput` via `slash-commands.ts` and handled client-side — they never hit the chat API.
- **Reminder kinds:** `notify` reminders just log an execution and surface a notification; `agent` reminders run the SDK autonomously via `scheduled-agent.ts`, persist their conversation turn, and clear a `runningSince` flag on completion. Both record an entry in the `executions` table.

### Agent capabilities

The agent has 8 tools: WebSearch, WebFetch, Read, Write, Edit, Glob, Grep, Bash. Two subagents are available for delegation: `researcher` (web + file reading) and `coder` (file editing + shell). Reminders are exposed via a built-in MCP server. Skills are exposed via a built-in `pollux-skills` MCP server — the agent scans an indexed name+description list on every turn and loads full skill content on demand via the `skill` tool. Extended thinking is enabled (adaptive mode), max 15 tool-use turns per request.

### Database

Schema in `src/lib/db/schema.ts`. Seven tables: `conversations`, `messages` (FK to conversations, cascade), `sessions`, `authConfig`, `recoveryCodes`, `reminders` (FK to conversations, cascade), `executions` (FK to conversations, cascade; kinds: `reminder_notify`, `reminder_agent`, `dream`). Migrations output to `drizzle/` and auto-run on startup. DB file at `data/pollux.db`.

### Memory system

Three markdown files in `data/memory/`:
- `profile.md` — User info and preferences
- `knowledge.md` — Persistent facts injected into every conversation
- `soul.md` — Agent personality and behavioral guidelines

All three are concatenated and injected into the system prompt on every chat request. The Dream system automatically maintains profile and knowledge from conversation content. Files are also editable via `/settings` UI and the `/api/memory` endpoint.

### Skills system

Procedural recipes stored as markdown files in `data/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `tags`) parsed by `gray-matter`. One directory per skill; supporting files (`examples/`, `templates/`, etc.) live alongside `SKILL.md` and are reachable only through the `pollux-skills` MCP tool (`view_file` action) — they are not on the agent's working-directory filesystem.

The system prompt gets a Skills block with one `name — description` line per valid skill. Full bodies load lazily when the agent calls the `skill` tool with `action='view'`. Skills can be created, updated, and deleted by the agent (same tool) or via the `/api/skills` REST endpoints from the settings UI (`/settings?section=skills`, or the `/skills` slash command). Invalid skill dirs (bad frontmatter, name ≠ dirname, oversized body, symlinked `SKILL.md`) surface via `readSkillDiagnostics()` and render as a banner in the Skills section.

Size caps enforced in `src/lib/skills.ts`: 32 KB per body, 32 KB per supporting-file read, 100 supporting files per skill. Soft warning in the UI above 30 skills (inflates every prompt). Symlinks are rejected at both load time and supporting-file read time.

### Config

- `next.config.ts` externalizes `better-sqlite3` and `@anthropic-ai/claude-agent-sdk` from bundling
- `drizzle.config.ts` points at `./data/pollux.db` with schema at `./src/lib/db/schema.ts`
- Path alias: `@/*` → `./src/*`
- User settings stored as JSON files in `data/`: `model.json`, `cwd.json`, `mcp-servers.json`

### Auth flow

`GET /` checks setup/auth status → redirects to `/setup` (first run), `/login`, or `/chat`. Sessions are 7-day HTTP-only cookies.

Auth endpoints at `/api/auth/`: `check`, `setup`, `login`, `logout`, `logout-all`, `profile`, `change-password`, `change-email`, `recover`, `regenerate-recovery`.

Setup requires email + password and generates 8 scrypt-hashed recovery codes (shown once). Recovery codes enable offline password reset from `/recover` without SMTP. Settings page at `/settings` for changing email, password, regenerating codes, model selection, MCP servers, working directory, memory editing, reminders management, and skills management. Deep-link via `?section=<key>` (e.g. `/settings?section=skills`).

## Testing

Tests live in `tests/*.test.ts`. File-backed tests mock `process.cwd()` and use temporary directories so they do not mutate the real `data/` tree. Test helpers in `tests/helpers/` provide mock cookies, request builders, and an in-memory test database.

Coverage scope (see `vitest.config.ts`) includes API routes (`auth`, `chat`, `conversations`, `memory`, `notifications`, `skills`), hooks (`useChatStream`), and lib modules (`auth`, `auth-guard`, `chat`, `memory`, `rate-limit`, `rate-limit-config`, `request-guards`, `cwd-store`, `mcp-store`, `executions`, `skills`, `skill-tool`, `skill-http`).
