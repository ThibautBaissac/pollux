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

Open [http://localhost:3000](http://localhost:3000). On first launch you'll be prompted to set a password. After that, you'll log in with that password on each session (7-day cookie).

## Production

```bash
npm run build
npm start
```

## Data

All persistent data lives in `data/` (gitignored):

| Path | Contents |
|------|----------|
| `data/pollux.db` | SQLite database (conversations, messages, auth, sessions) |
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
| Auth | scrypt password hashing, HTTP-only session cookies |
| Streaming | Server-Sent Events |
| Markdown | react-markdown + remark-gfm + rehype-highlight |

## Project structure

```
src/
  app/
    api/chat/route.ts       # SSE streaming endpoint
    api/conversations/       # Conversation CRUD
    api/auth/                # Login, logout, setup, status check
    chat/                    # Chat pages (new + [id])
    login/, setup/           # Auth pages
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
    auth-guard.ts            # requireAuth() middleware
    memory.ts                # Knowledge base read/write
    db/                      # Drizzle schema and SQLite connection
  types/
    index.ts                 # Shared types (Message, Conversation, ToolUse)
```

## License

Private.
