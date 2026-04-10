# Pollux

A local-first personal AI assistant powered by the Claude Agent SDK. Single-user, privacy-focused, with a minimal dark UI.

All data stays on your machine: conversations and auth live in a local SQLite database, and the knowledge base is a plain markdown file you can edit directly.

## Prerequisites

- Node.js 20+
- An Anthropic API key (the Claude Agent SDK reads `ANTHROPIC_API_KEY` from your environment)

## Setup

```bash
git clone <repo-url> && cd pollux
npm install
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first launch you'll create your account with an email and password. You'll receive 8 one-time recovery codes -- save them somewhere safe, they're your only way to reset your password without external services.

## Production

```bash
npm run build
npm start
```

## Testing

The project uses `Vitest` for Node-side unit tests and V8-powered coverage reporting.

```bash
npm test          # run the test suite once
npm run test:watch
npm run coverage  # terminal summary + HTML report in coverage/
```

Current coverage is scoped to the server-side utility modules that are covered by the suite today:

- `src/lib/memory.ts`
- `src/lib/rate-limit.ts`
- `src/lib/rate-limit-config.ts`
- `src/lib/request-guards.ts`

Tests live under `tests/`. They run in a Node environment and avoid touching the real `data/` directory by using temporary directories for file-backed memory tests.

## Auth

Single-user authentication with 7-day HTTP-only session cookies.

- **Setup** (`/setup`) -- create your account with email + password; generates 8 recovery codes
- **Login** (`/login`) -- password authentication
- **Password reset** (`/recover`) -- use a recovery code to set a new password (no email service needed)
- **Settings** (`/settings`) -- change email, change password, regenerate recovery codes, log out all sessions

All password-changing operations (change password, recovery) invalidate existing sessions. Recovery codes are individually hashed with scrypt and each code works exactly once. If all 8 are used, regenerate from settings while logged in.

## Data

All persistent data lives in `data/` (gitignored):

| Path | Contents |
|------|----------|
| `data/pollux.db` | SQLite database (conversations, messages, auth, sessions, recovery codes) |
| `data/memory/knowledge.md` | Knowledge base injected into every conversation's system prompt |

The database is created automatically on first run. Migrations in `drizzle/` are applied at startup.

### Knowledge base

Edit `data/memory/knowledge.md` to give Pollux persistent context about you. This file is read on every chat request and included in the system prompt. Example:

```markdown
# Knowledge Base

- My name is Alex, I'm a backend engineer at Acme Corp
- Our stack is Go + PostgreSQL + Kubernetes
- Preferred timezone: Europe/Paris
```

## Agent capabilities

Pollux uses `claude-sonnet-4-6` with two tools enabled:

- **WebSearch** -- search the web for current information
- **WebFetch** -- fetch and read web page content

Extended thinking is enabled (adaptive mode). Sessions are persisted so follow-up messages in a conversation resume the same agent session. Max 15 tool-use turns per request.

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

## Project structure

```
tests/
  *.test.ts                  # Vitest suite for server-side utilities
src/
  app/
    api/chat/route.ts       # SSE streaming endpoint
    api/conversations/       # Conversation CRUD
    api/auth/                # Auth (login, setup, password/email change, recovery)
    chat/                    # Chat pages (new + [id])
    login/, setup/, recover/ # Auth pages
    settings/                # Account settings (email, password, recovery codes)
  components/
    chat/                    # ChatView, MessageList, MessageBubble, ChatInput
    sidebar/                 # Sidebar, ConversationItem
  hooks/
    useChat.ts               # Chat state machine (messages, streaming, abort)
    useConversations.ts      # Sidebar conversation list
    useAutoScroll.ts         # Auto-scroll on new messages
  lib/
    agent.ts                 # SDK configuration and system prompt
    auth.ts                  # Password hashing and session lifecycle
    auth-guard.ts            # requireAuth() and requirePasswordConfirmation() guards
    memory.ts                # Knowledge base read/write
    rate-limit.ts            # In-memory auth rate limiting
    request-guards.ts        # Origin/fetch-site checks and JSON request parsing
    db/                      # Drizzle schema and SQLite connection
  types/
    index.ts                 # Shared types (Message, Conversation, ToolUse)
```

## License

Private.
