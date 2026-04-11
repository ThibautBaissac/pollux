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
  - `settings/` — Model selection, working directory, MCP server configuration
- `src/lib/` — Server-side logic:
  - `agent.ts` — SDK config, system prompt, tool list, subagent definitions
  - `auth.ts` / `auth-guard.ts` — Password hashing, sessions, route protection
  - `memory.ts` — Three memory files (profile, knowledge, soul) at `data/memory/`, history log for Dream
  - `dream.ts` / `dream-config.ts` — Automated memory extraction (Phase 1: summarize conversations → history.jsonl, Phase 2: analyze + edit memory files)
  - `git-memory.ts` — Git commits for memory file changes
  - `model-store.ts` / `cwd-store.ts` / `mcp-store.ts` — JSON-file persistence for user settings
  - `reminder-tool.ts` — Built-in MCP server exposing reminder add/list/remove to the agent
  - `reminders.ts` — Reminder business logic (CRUD, cron parsing, scheduling)
  - `db/` — Drizzle schema + SQLite connection with auto-migration
- `src/hooks/` — Client state:
  - `useChat` — Chat state machine (messages, optimistic updates, abort)
  - `useChatStream` — SSE stream parsing, tool use merging
  - `useConversations` — Sidebar conversation list
  - `useAutoScroll` — Scroll-to-bottom behavior
- `src/components/` — React components:
  - `chat/` — ChatView, MessageList, MessageBubble, ChatInput
  - `sidebar/` — Sidebar, ConversationItem
  - `settings/` — Model select, MCP editor, memory editor, reminders manager, working directory, auth forms
- `src/types/` — Shared TypeScript types (Message, Conversation, ToolUse)

### Key patterns

- **No global state library.** State lives in hooks exposed via React context (`ChatStreamContext`).
- **SSE protocol:** Events are `init`, `delta`, `tool`, `done`, `error`. Text deltas accumulate in client state; assistant messages are persisted server-side on completion.
- **Optimistic updates:** User + empty assistant message added immediately. Rolled back if error occurs before first delta.
- **Session resume:** SDK session ID stored on conversation record. Resume attempted on follow-up messages; auto-clears and retries fresh if corrupted (up to 2 retries).
- **Tool-only frame merging:** Frames with only tool use (no text) are deferred and merged into the next text-containing frame to avoid empty message rows.
- **Dream system:** Background process runs every 10 minutes. Phase 1 summarizes recent conversations into `history.jsonl`. Phase 2 (triggered by entry count or time threshold) uses the agent to analyze history and edit memory files, then commits changes via git.
- **MCP servers:** User-configured MCP servers (stdio/http/sse) are merged with the built-in `pollux-reminders` server and passed to the SDK on every chat request. Config stored in `data/mcp-servers.json`.

### Agent capabilities

The agent has 8 tools: WebSearch, WebFetch, Read, Write, Edit, Glob, Grep, Bash. Two subagents are available for delegation: `researcher` (web + file reading) and `coder` (file editing + shell). Reminders are exposed via a built-in MCP server. Extended thinking is enabled (adaptive mode), max 15 tool-use turns per request.

### Database

Schema in `src/lib/db/schema.ts`. Six tables: `conversations`, `messages` (FK to conversations with cascade delete), `sessions`, `authConfig`, `recoveryCodes`, `reminders` (FK to conversations with cascade delete). Migrations output to `drizzle/` and auto-run on startup. DB file at `data/pollux.db`.

### Memory system

Three markdown files in `data/memory/`:
- `profile.md` — User info and preferences
- `knowledge.md` — Persistent facts injected into every conversation
- `soul.md` — Agent personality and behavioral guidelines

All three are concatenated and injected into the system prompt on every chat request. The Dream system automatically maintains profile and knowledge from conversation content. Files are also editable via `/settings` UI and the `/api/memory` endpoint.

### Config

- `next.config.ts` externalizes `better-sqlite3` and `@anthropic-ai/claude-agent-sdk` from bundling
- `drizzle.config.ts` points at `./data/pollux.db` with schema at `./src/lib/db/schema.ts`
- Path alias: `@/*` → `./src/*`
- User settings stored as JSON files in `data/`: `model.json`, `cwd.json`, `mcp-servers.json`

### Auth flow

`GET /` checks setup/auth status → redirects to `/setup` (first run), `/login`, or `/chat`. Sessions are 7-day HTTP-only cookies.

Auth endpoints at `/api/auth/`: `check`, `setup`, `login`, `logout`, `logout-all`, `profile`, `change-password`, `change-email`, `recover`, `regenerate-recovery`.

Setup requires email + password and generates 8 scrypt-hashed recovery codes (shown once). Recovery codes enable offline password reset from `/recover` without SMTP. Settings page at `/settings` for changing email, password, regenerating codes, model selection, MCP servers, working directory, memory editing, and reminders management.

## Testing

Tests live in `tests/*.test.ts`. File-backed tests mock `process.cwd()` and use temporary directories so they do not mutate the real `data/` tree. Test helpers in `tests/helpers/` provide mock cookies, request builders, and an in-memory test database.

Coverage scope (see `vitest.config.ts`) includes API routes (`auth`, `chat`, `conversations`, `memory`), hooks (`useChatStream`), and lib modules (`auth`, `auth-guard`, `chat`, `memory`, `rate-limit`, `request-guards`, `cwd-store`, `mcp-store`).
