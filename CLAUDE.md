# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pollux is a local-first personal AI assistant PWA built with the Claude Agent SDK. Single-user, privacy-focused, dark UI inspired by Signal. SQLite database, no external services beyond the Anthropic API.

## Commands

```bash
npm run dev       # Next.js dev server on :3000
npm run build     # Production build
npm start         # Production server
npm run lint      # ESLint
npm test          # Vitest run
npm run test:watch
npm run coverage  # V8 coverage report + coverage/index.html
```

The test suite uses `Vitest` in a Node environment. Coverage is collected with `@vitest/coverage-v8`.

Current coverage scope is intentionally narrow and focused on pure server-side utility modules:

- `src/lib/memory.ts`
- `src/lib/rate-limit.ts`
- `src/lib/rate-limit-config.ts`
- `src/lib/request-guards.ts`

Tests live in `tests/*.test.ts`. File-backed tests mock `process.cwd()` and use temporary directories so they do not mutate the real `data/` tree.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5
- **Styling:** Tailwind CSS 4 via PostCSS, `@tailwindcss/typography` for markdown prose
- **Database:** SQLite (better-sqlite3, WAL mode) with Drizzle ORM
- **Agent:** `@anthropic-ai/claude-agent-sdk` — model is `claude-sonnet-4-6`
- **Auth:** Cookie-based sessions, scrypt password hashing, single-user, recovery codes for offline password reset
- **Streaming:** Server-Sent Events (SSE) via ReadableStream
- **Testing:** Vitest 4 with V8 coverage

## Architecture

### Layers

- `src/app/api/` — Next.js route handlers. `POST /api/chat` is the core SSE streaming endpoint. CRUD for conversations at `/api/conversations/`. Auth endpoints at `/api/auth/`.
- `src/lib/` — Server-side logic. `agent.ts` (SDK config, system prompt), `auth.ts` (password hashing, sessions), `auth-guard.ts` (route protection middleware), `memory.ts` (file-based knowledge base at `data/memory/knowledge.md`), `db/` (Drizzle schema + SQLite connection with auto-migration).
- `src/hooks/` — Client state. `useChat` is the main chat state machine (messages, SSE parsing, optimistic updates, abort). `useConversations` manages the sidebar list. `useAutoScroll` handles scroll-to-bottom.
- `src/components/` — React components. `chat/` (ChatView, MessageList, MessageBubble, ChatInput) and `sidebar/` (Sidebar, ConversationItem).
- `src/types/` — Shared TypeScript types (Message, Conversation, ToolUse).

### Key patterns

- **No global state library.** State lives in hooks (`useChat`, `useConversations`) exposed via React context (`ChatStreamContext`).
- **SSE protocol:** Events are `init`, `delta`, `tool`, `done`, `error`. Text deltas accumulate in client state; assistant messages are persisted server-side on completion.
- **Optimistic updates:** User + empty assistant message added immediately. Rolled back if error occurs before first delta.
- **Session resume:** SDK session ID stored on conversation record. Resume attempted on follow-up messages; auto-clears and retries fresh if corrupted (up to 2 retries).
- **Tool-only frame merging:** Frames with only tool use (no text) are deferred and merged into the next text-containing frame to avoid empty message rows.
- **Memory:** Markdown file read on every chat request and injected into the system prompt. No DB storage — designed for manual editing.

### Database

Schema in `src/lib/db/schema.ts`. Five tables: `conversations`, `messages` (FK to conversations with cascade delete), `sessions`, `authConfig`, `recoveryCodes`. Migrations output to `drizzle/` and auto-run on startup. DB file at `data/pollux.db`.

### Config

- `next.config.ts` externalizes `better-sqlite3` and `@anthropic-ai/claude-agent-sdk` from bundling
- `drizzle.config.ts` points at `./data/pollux.db` with schema at `./src/lib/db/schema.ts`
- Path alias: `@/*` → `./src/*`

### Auth flow

`GET /` checks setup/auth status → redirects to `/setup` (first run), `/login`, or `/chat`. Sessions are 7-day HTTP-only cookies.

Auth endpoints at `/api/auth/`: `check`, `setup`, `login`, `logout`, `logout-all`, `profile`, `change-password`, `change-email`, `recover`, `regenerate-recovery`.

Setup requires email + password and generates 8 scrypt-hashed recovery codes (shown once). Recovery codes enable offline password reset from `/recover` without SMTP. Settings page at `/settings` for changing email, password, regenerating codes, and logging out all sessions.
