# Pollux

A local-first personal AI assistant powered by the Claude Agent SDK. Single-user, privacy-focused, with a minimal dark UI.

All data stays on your machine: conversations and auth live in a local SQLite database, and the knowledge base is a set of plain markdown files you can edit directly.

## Prerequisites

- Node.js 20+
- An Anthropic API key (the Claude Agent SDK reads `ANTHROPIC_API_KEY` from your environment)

## Setup

```bash
git clone <repo-url> && cd pollux
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first launch you'll create your account with an email and password. You'll receive 8 one-time recovery codes -- save them somewhere safe, they're your only way to reset your password without external services.

## Production

```bash
npm run build
npm start
```

Both `dev` and `start` auto-run database migrations via predev/prestart hooks.

## Testing

```bash
npm test                              # run the test suite once
npm run test:watch                    # watch mode
npm run coverage                      # terminal summary + HTML report in coverage/
npx vitest run tests/memory.test.ts   # single file
npx vitest run -t "pattern"           # single test by name
```

Tests live under `tests/` and run in a Node environment. File-backed tests use temporary directories so they never touch the real `data/` tree. Coverage scope is defined in `vitest.config.ts`.

## Data

All persistent data lives in `data/` (gitignored):

| Path | Contents |
|------|----------|
| `data/pollux.db` | SQLite database (conversations, messages, auth, sessions, recovery codes, reminders) |
| `data/memory/profile.md` | User info and preferences |
| `data/memory/knowledge.md` | Persistent facts injected into every conversation |
| `data/memory/soul.md` | Agent personality and behavioral guidelines |
| `data/memory/history.jsonl` | Conversation summaries consumed by the Dream system |
| `data/model.json` | Selected model |
| `data/cwd.json` | Working directory for shell operations |
| `data/mcp-servers.json` | User-configured MCP servers |

The database is created automatically on first run. Migrations in `drizzle/` are applied at startup.

### Memory files

Edit the markdown files in `data/memory/` to give Pollux persistent context. All three are concatenated and injected into the system prompt on every chat request:

- **profile.md** -- Who you are, your preferences
- **knowledge.md** -- Facts Pollux should always know
- **soul.md** -- Agent personality and response style

These files are also editable from the Settings page. The Dream system automatically updates profile and knowledge based on your conversations.

## Features

### Agent tools

The agent has 8 tools available: WebSearch, WebFetch, Read, Write, Edit, Glob, Grep, Bash. Two subagents can be delegated to: `researcher` (web + file reading) and `coder` (file editing + shell). Extended thinking is enabled (adaptive mode), max 15 tool-use turns per request.

### Model selection

Choose between Opus 4.6, Sonnet 4.6 (default), and Haiku 4.5 from the Settings page or via `PUT /api/settings/model`.

### Reminders

Create one-time or recurring reminders with cron expressions and timezone support. The agent can create reminders via a built-in MCP server tool, or manage them from the Settings page.

### MCP servers

Add external MCP servers (stdio, HTTP, SSE) from the Settings page. They're merged with the built-in `pollux-reminders` server and passed to the SDK on every chat request.

### Dream system

A background process that runs every 10 minutes:
- **Phase 1** -- Summarizes recent conversations into `history.jsonl`
- **Phase 2** -- Analyzes accumulated history and edits memory files (profile, knowledge), then commits changes via git

Configuration in `src/lib/dream-config.ts`.

### Working directory

Set the working directory for filesystem and shell tools from Settings or via `PUT /api/settings/cwd`.

## Auth

Single-user authentication with 7-day HTTP-only session cookies.

- **Setup** (`/setup`) -- create your account with email + password; generates 8 recovery codes
- **Login** (`/login`) -- password authentication
- **Password reset** (`/recover`) -- use a recovery code to set a new password (no email service needed)
- **Settings** (`/settings`) -- account, model, memory, reminders, MCP servers, working directory

All password-changing operations invalidate existing sessions. Recovery codes are individually hashed with scrypt and each code works exactly once.

## Security model

Pollux is designed for **single-user, localhost-only** use. Several features deliberately trust the authenticated user with the same privileges as the OS account running the app:

- **Registered stdio MCP servers** spawn arbitrary commands with full access to the user's environment and filesystem.
- **The agent's Bash / Write / Edit tools** operate in the configured working directory with the app user's permissions.
- **The working directory setting** accepts any path on disk, including `$HOME` or `/`.

Do not expose Pollux on a network interface, do not share session cookies, and do not use it behind a reverse proxy without additional access control. A stolen session cookie effectively grants shell access to the host.

## Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Database | SQLite (better-sqlite3, WAL mode) + Drizzle ORM |
| Agent | @anthropic-ai/claude-agent-sdk |
| Auth | scrypt password hashing, HTTP-only session cookies, recovery codes |
| Streaming | Server-Sent Events |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Testing | Vitest + V8 coverage |

## License

Private.
