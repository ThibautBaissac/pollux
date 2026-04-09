# Pollux — Personal AI Assistant PWA

## Context

Personal AI assistant PWA inspired by zeroClaw (local-first, private,
single-user, modular). Web interface replaces messaging apps. Powered
by the Claude Agent SDK (TypeScript). No phone number needed.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Model | Claude Sonnet 4.6 | Cost-effective for daily use |
| MVP scope | Chat + Memory + Web search | Minimum useful assistant |
| UI | Minimal dark (Signal-style) | User preference |
| Auth | Password (cookie sessions) | Simplest single-user auth |
| DB | SQLite + Drizzle ORM | Local-first, zero-config |
| Streaming | SSE via ReadableStream | Unidirectional, Next.js native |
| Stack | Next.js 15 + Tailwind v4 + React 19 | Full-stack TypeScript |
| System prompt | Custom string (not preset) | Personal assistant, not coding agent |
| IDs | `crypto.randomUUID()` | No `uuid` package needed |
| SDK auth | `CLAUDE_CODE_OAUTH_TOKEN` env var | OAuth token for Claude Agent SDK |

## Architecture

```
Browser (PWA)                         Server (Next.js API routes)
┌───────────────┐                     ┌─────────────────────────┐
│  Chat UI      │  POST /api/chat     │  Auth middleware         │
│  useChat()    │ ──────────────────► │  ↓                      │
│  (fetch SSE)  │ ◄── SSE stream ─── │  agent.ts               │
│               │                     │  ↓                      │
│  Cancel btn   │  AbortController    │  Claude Agent SDK       │
│  ──────────── │ ──────────────────► │  query() → async gen    │
└───────────────┘                     │  ↓                      │
                                      │  Anthropic API          │
                                      │  (Sonnet 4.6)           │
                                      ├─────────────────────────┤
                                      │  SQLite (conversations, │
                                      │   messages, sessions)   │
                                      │  Markdown (memory)      │
                                      └─────────────────────────┘
```

### Streaming flow (end-to-end)

1. Client POSTs `{ conversationId?, message }` to `/api/chat`
2. API route validates auth cookie; if `conversationId` provided, loads
   existing conversation; if omitted, creates a new one. Loads memory.
3. **Emit `event: init` with `conversationId` immediately** — before
   calling the SDK. This guarantees the client always learns the
   conversation ID, even if the SDK fails to start.
4. Calls `query()` with `includePartialMessages: true`, `resume: sdkSessionId`
5. **Accumulates assistant text** from deltas into a `partialText` buffer
   as it iterates the `AsyncGenerator<SDKMessage>`:
   - `type: "system", subtype: "init"` → store `session_id` on conversation row
   - `type: "stream_event"` → extract `content_block_delta.text_delta`,
     append to `partialText`, emit `event: delta`
   - `type: "assistant"` → extract full text from `message.content`
     TextBlocks → **persist assistant message to DB**
   - `type: "tool_progress"` → emit `event: tool` with tool name + elapsed time
   - `type: "result"` → emit `event: done` with cost/usage metadata
     (do NOT persist content from here — `result.result` is a summary
     string, not the full response)
6. Client reads `response.body` with `getReader()`, parses SSE, appends deltas
7. **Cancel/abort handling**: Cancel button calls
   `abortController.abort()` → SDK throws `AbortError`. The API route
   catches this in a `try/catch` around the iterator and **persists
   `partialText`** as the assistant message (treated as a normal
   message — no special "incomplete" status). This matches the
   ChatGPT/Vercel AI SDK convention: partial responses are preserved.
   **Known SDK issue**: aborting immediately after the `init` system
   message can corrupt the SDK session (GitHub #69). Mitigation: if
   resume fails, discard the stale `sdk_session_id` and start a fresh
   SDK session (the DB history is still intact).
8. **Network disconnect**: same as cancel — the stream closes, the
   server catches the error and persists `partialText`.

### System prompt strategy

Use a **custom system prompt string** (not the `claude_code` preset). Reasons:
- The `claude_code` preset includes extensive coding-specific instructions
  (file conventions, commit discipline, code style) irrelevant for a personal
  assistant
- The SDK's default minimal prompt contains only tool instructions, but a custom
  string replaces it entirely — so we include our own tool guidance
- The custom prompt = Pollux persona + tool descriptions + user's memory content

```typescript
const systemPrompt = `You are Pollux, a personal AI assistant.
You are helpful, direct, and concise. You remember context from the
user's knowledge base (provided below) and use tools when helpful.

## Available tools
- WebSearch: Search the web for current information
- WebFetch: Fetch and read web page content

## Knowledge base
${memoryContent}

Current date: ${new Date().toISOString().split('T')[0]}`;
```

### Session lifecycle (SDK ↔ DB mapping)

The SDK manages conversation state internally (JSONL files in
`~/.claude/projects/`). Pollux mirrors key data to SQLite for fast UI:

- **New conversation**: create conversation row in DB first, then call
  `query()` without `resume` → get `session_id` from init message →
  update `conversations.sdk_session_id`
- **Resume conversation**: call `query({ options: { resume: sdkSessionId } })`.
  If resume fails (e.g., corrupted session from prior abort — SDK #69),
  clear `sdk_session_id` and start a fresh SDK session.
- **Display history**: read from `messages` table (fast), not SDK JSONL
- **Graceful degradation**: if SDK session file is lost, start fresh
  (user sees history from DB but agent loses context)

## Directory Structure

```
pollux/
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── data/                          # gitignored — auto-created on first run
│   ├── pollux.db
│   └── memory/knowledge.md
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout, dark mode, SW registration
│   │   ├── page.tsx               # Redirect → /chat or /login or /setup
│   │   ├── globals.css            # Tailwind v4 (CSS-based config, no tailwind.config.ts)
│   │   ├── setup/
│   │   │   └── page.tsx           # First-run: set password
│   │   ├── login/
│   │   │   └── page.tsx           # Enter password
│   │   ├── chat/
│   │   │   ├── layout.tsx         # Sidebar + main area (responsive)
│   │   │   ├── page.tsx           # New conversation (empty state)
│   │   │   └── [id]/
│   │   │       └── page.tsx       # Conversation view
│   │   ├── settings/
│   │   │   └── page.tsx           # Memory editor
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── setup/route.ts # POST: set initial password (first-run only)
│   │       │   ├── login/route.ts # POST: authenticate
│   │       │   ├── logout/route.ts
│   │       │   └── check/route.ts # GET: validate session
│   │       ├── conversations/
│   │       │   ├── route.ts       # GET: list
│   │       │   └── [id]/
│   │       │       └── route.ts   # GET: messages, DELETE: remove, PATCH: rename
│   │       ├── chat/
│   │       │   └── route.ts       # POST: send message → SSE stream
│   │       └── memory/
│   │           └── route.ts       # GET/PUT: knowledge base
│   ├── lib/
│   │   ├── agent.ts               # Claude Agent SDK wrapper
│   │   ├── auth.ts                # Password hashing + session tokens
│   │   ├── db/
│   │   │   ├── index.ts           # Drizzle singleton (auto-init)
│   │   │   └── schema.ts          # Tables
│   │   ├── memory.ts              # Read/write knowledge.md
│   │   └── auth-guard.ts          # API route auth check helper
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatStreamProvider.tsx # Context: owns stream, messages, abort
│   │   │   ├── ChatView.tsx       # Container: messages + input
│   │   │   ├── MessageList.tsx    # Scrollable message list
│   │   │   ├── MessageBubble.tsx  # Single message (markdown, tool indicators)
│   │   │   └── ChatInput.tsx      # Textarea + send/stop buttons
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx        # Conversation list
│   │   │   └── ConversationItem.tsx
│   │   ├── auth/
│   │   │   └── LoginForm.tsx
│   │   └── settings/
│   │       └── MemoryEditor.tsx
│   ├── hooks/
│   │   ├── useChat.ts             # SSE consumer, message state, abort
│   │   ├── useConversations.ts    # Conversation list CRUD
│   │   └── useAutoScroll.ts       # Scroll to bottom on new messages
│   └── types/
│       └── index.ts
├── next.config.ts                 # serverExternalPackages: ['better-sqlite3']
├── drizzle.config.ts
├── .env.example                   # CLAUDE_CODE_OAUTH_TOKEN=
└── .gitignore                     # data/, .env.local, node_modules/
```

Key differences from v1 of this plan:
- Added `/setup` page for first-run password creation
- Added `/api/auth/setup/route.ts`
- Removed `tailwind.config.ts` (v4 uses CSS-based config in `globals.css`)
- Removed `useAuth.ts` hook (login/setup are full pages, not hook-driven)
- `middleware.ts` renamed to `auth-guard.ts` (avoids confusion with Next.js middleware)
- `next.config.ts` explicitly noted for `serverExternalPackages`

## Database Schema

```typescript
// src/lib/db/schema.ts
export const conversations = sqliteTable("conversations", {
  id:             text("id").primaryKey(),         // crypto.randomUUID()
  sdkSessionId:   text("sdk_session_id"),          // from SDK init message
  title:          text("title").notNull().default("New conversation"),
  createdAt:      integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt:      integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id:             text("id").primaryKey(),
  conversationId: text("conversation_id").notNull()
                    .references(() => conversations.id, { onDelete: "cascade" }),
  role:           text("role", { enum: ["user", "assistant"] }).notNull(),
  content:        text("content").notNull(),
  toolUses:       text("tool_uses"),               // JSON: [{ name, input_summary }]
  createdAt:      integer("created_at", { mode: "timestamp" }).notNull(),
});

export const authConfig = sqliteTable("auth_config", {
  key:   text("key").primaryKey(),                 // "password_hash"
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token:     text("token").primaryKey(),           // crypto.randomBytes(32).toString('hex')
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});
```

Changes from v1:
- Added `authConfig` table (stores password hash in DB, not env var) — enables
  first-run setup page
- Removed `system` role from messages (we never store system messages)
- Removed `costUsd` from messages (available in result message, not critical for MVP)

### DB initialization

**Strategy**: Checked-in SQL migration files + explicit bootstrap script.

`drizzle-kit push` is a CLI workflow, not a runtime API — it cannot be
called programmatically inside `db/index.ts`. Doing schema mutation
lazily on the first HTTP request is also brittle (race conditions if two
requests arrive simultaneously).

Instead:
1. Use `drizzle-kit generate` during development to produce SQL migration
   files in `drizzle/`. These are committed to git.
2. Use Drizzle's `migrate()` function from
   `drizzle-orm/better-sqlite3/migrator` to apply migrations. For SQLite
   with `better-sqlite3` this is **synchronous** — no async races.
3. Call `migrate()` once at process startup via a `bootstrap()` function
   in `src/lib/db/index.ts`, NOT lazily per-request.

```typescript
// src/lib/db/index.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "fs";

mkdirSync("data/memory", { recursive: true });

const sqlite = new Database("data/pollux.db");
export const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "drizzle" }); // sync, runs once at import
```

4. `data/memory/knowledge.md` is created with an empty default if missing
   by `src/lib/memory.ts` on first read.

**Development workflow**:
- Edit `schema.ts` → run `npx drizzle-kit generate` → commit the SQL file
- On next `npm run dev`, `migrate()` applies any new migrations automatically

## API Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/setup` | No | Set password (only works if no password exists) |
| POST | `/api/auth/login` | No | Authenticate → set session cookie |
| POST | `/api/auth/logout` | Yes | Destroy session |
| GET | `/api/auth/check` | No | Returns `{ authenticated, setupRequired }` |
| GET | `/api/conversations` | Yes | List conversations (id, title, updatedAt) |
| GET | `/api/conversations/[id]` | Yes | Get conversation with messages |
| DELETE | `/api/conversations/[id]` | Yes | Delete conversation |
| PATCH | `/api/conversations/[id]` | Yes | Rename conversation |
| POST | `/api/chat` | Yes | Send message → SSE stream (creates conversation lazily if `conversationId` omitted) |
| GET | `/api/memory` | Yes | Read knowledge.md content |
| PUT | `/api/memory` | Yes | Update knowledge.md content |

### SSE event format (`/api/chat`)

```
event: init
data: {"sessionId":"...","conversationId":"..."}

event: delta
data: {"text":"Hello, "}

event: tool
data: {"name":"WebSearch","status":"running","elapsed":2.1}

event: tool
data: {"name":"WebSearch","status":"done"}

event: done
data: {"costUsd":0.003,"turns":2}

event: error
data: {"message":"Rate limited","retryAfter":30}
```

## Agent Configuration

The SDK authenticates via the `CLAUDE_CODE_OAUTH_TOKEN` environment
variable, loaded from `.env` (or `.env.local`). This is an OAuth token
for the Claude Agent SDK — **not** an Anthropic API key.

```
# .env
CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token-here
```

```typescript
// src/lib/agent.ts — key options passed to query()
// The SDK reads CLAUDE_CODE_OAUTH_TOKEN from the environment automatically.
{
  prompt: userMessage,
  options: {
    model: "claude-sonnet-4-6",
    systemPrompt: buildSystemPrompt(memoryContent),
    resume: sdkSessionId ?? undefined,         // omit for new conversation
    allowedTools: ["WebSearch", "WebFetch"],
    permissionMode: "dontAsk",                 // deny anything not in allowedTools
    includePartialMessages: true,              // streaming deltas
    abortController: controller,               // for cancel button
    maxTurns: 15,                              // safety limit on tool loops
    thinking: { type: "adaptive" },            // let model decide when to think
    cwd: process.cwd(),                        // for SDK session storage
    persistSession: true,                      // save sessions to disk
  }
}
```

**Why `dontAsk` + `allowedTools`, not `bypassPermissions`:**

The SDK evaluates permissions as: deny → permission mode → allow rules →
canUseTool. `allowedTools` only *pre-approves* listed tools; it does NOT
restrict the agent to only those tools. `bypassPermissions` approves
*everything* that reaches the permission mode step — so
`allowedTools: ["WebSearch"]` + `bypassPermissions` still approves
`Bash`, `Edit`, `Write`, etc. Additionally, `bypassPermissions` requires
`allowDangerouslySkipPermissions: true`.

`dontAsk` is the correct locked-down mode: listed tools are approved,
everything else is denied outright without prompting.
```

## Hosting Constraints

The Claude Agent SDK is a **stateful, long-running process** — it
maintains conversation state in JSONL files on disk, executes tools in
a persistent shell, and expects a stable filesystem. This has direct
deployment implications:

**Pollux MUST run as a persistent Node.js process**, not a stateless
serverless function. Compatible environments:
- `next start` on a local machine or VPS (MVP target)
- Docker container with mounted volumes for `data/` **and** `~/.claude/`
- Fly Machines, Railway, Render — any persistent container host
- Hybrid pattern: ephemeral container hydrated with state on startup

**Incompatible environments** (no persistent filesystem):
- Vercel serverless functions (ephemeral `/tmp`, no persistent disk)
- AWS Lambda, Google Cloud Functions
- Cloudflare Workers / Edge functions
- Any platform that scales to zero and destroys the filesystem

**What requires persistent disk** (two volume mounts in Docker):
- `data/pollux.db` — SQLite database (conversations, messages, auth)
- `data/memory/knowledge.md` — user's knowledge base
- `~/.claude/projects/` — SDK session JSONL files (for conversation resume).
  **The SDK hardcodes this path** — there is no config option to redirect
  it into `data/`. Mount `~/.claude/` as a separate volume
  (e.g., `./claude-home:/root/.claude`). Open feature requests:
  [#84](https://github.com/anthropics/claude-agent-sdk-typescript/issues/84),
  [#97](https://github.com/anthropics/claude-agent-sdk-typescript/issues/97).

**What requires outbound network**:
- HTTPS to `api.anthropic.com` (LLM inference)
- HTTPS to the open web (WebSearch and WebFetch tools)

## Mobile Navigation

On mobile (< 768px):
- **Conversation list** = full-screen view (Sidebar component)
- **Tap conversation** = navigate to `/chat/[id]`, sidebar hidden
- **Back button** (top-left) = navigate to `/chat`, shows sidebar
- **No split view** — one screen at a time, like iMessage

On desktop (≥ 768px):
- **Sidebar** = fixed left panel (280px)
- **Chat** = remaining width
- Sidebar always visible

Implemented via CSS media queries + Next.js navigation (no JS toggle needed).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| API key missing/invalid | `/api/chat` returns `event: error` with clear message |
| Rate limited | `event: error` with `retryAfter` seconds |
| Anthropic API down | `event: error`, suggest retry later |
| SDK session file lost | Start new session, log warning, DB history preserved |
| User sends message while streaming | Input disabled during streaming (send button becomes stop button) |
| User cancels mid-stream | `AbortController.abort()` → SDK throws `AbortError` → server persists accumulated partial text as assistant message → client shows what was streamed |
| Network disconnect mid-stream | Server catches stream close error, persists accumulated partial text → client shows "Connection lost", partial response preserved on refresh |
| SDK abort corrupts session (#69) | On next resume failure, clear `sdk_session_id`, start fresh SDK session (DB history preserved) |

## Implementation Phases

### Phase 1: Scaffold + DB + Auth

**Goal**: App runs, shows login page, authenticates.

1. `npx create-next-app@latest pollux` — TypeScript, Tailwind, App Router, ESLint
2. Install deps:
   ```
   npm i @anthropic-ai/claude-agent-sdk better-sqlite3 drizzle-orm react-markdown remark-gfm rehype-highlight
   npm i -D @types/better-sqlite3 drizzle-kit
   ```
3. Configure `next.config.ts`:
   ```typescript
   serverExternalPackages: ['better-sqlite3']
   ```
4. Set up Tailwind v4 dark theme in `globals.css` (CSS-based config)
5. Create `.env.example` (with `CLAUDE_CODE_OAUTH_TOKEN=`), `.gitignore` (include `data/`, `.env`, `.env.local`)
6. Implement `src/lib/db/` — schema, singleton with `migrate()` at import time, run `npx drizzle-kit generate` for initial migration
7. Implement `src/lib/auth.ts` — `hashPassword()`, `verifyPassword()`, `createSession()`, `validateSession()`.
   `createSession()` MUST set the session cookie with these flags:
   ```typescript
   cookies().set("session", token, {
     httpOnly: true,
     secure: process.env.NODE_ENV === "production",
     sameSite: "lax",
     path: "/",
     maxAge: 60 * 60 * 24 * 7, // 7 days
   });
   ```
8. Implement `src/lib/auth-guard.ts` — reusable auth check for API routes
9. Build API routes: `/api/auth/setup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/check`
10. Build pages: `/setup` (set password form), `/login` (enter password form), `/` (redirect logic)

**Verify**: `npm run dev` → visit localhost:3000 → redirected to `/setup` → set password → redirected to `/login` → enter password → redirected to `/chat` (empty page for now)

### Phase 2: Agent + Chat (vertical slice)

**Goal**: Send a message, see streaming response. One conversation, no sidebar.

1. Implement `src/lib/memory.ts` — `readMemory()`, `writeMemory()`, auto-create default
2. Implement `src/lib/agent.ts` — `buildSystemPrompt()`, `startAgent()` wrapper
3. Build `/api/chat/route.ts` — SSE streaming endpoint:
   - Accept `{ conversationId?, message }` — `conversationId` is optional
   - If `conversationId` is null/missing: create conversation row (lazy creation)
   - Insert user message row in DB
   - **Emit `event: init` with `conversationId` immediately** (before SDK call)
   - Call `query()` with `includePartialMessages: true`
   - Accumulate text deltas into `partialText` buffer throughout iteration
   - Transform `SDKMessage` stream → SSE events via `ReadableStream`:
     - On SDK `init`: store `sdk_session_id` on conversation row
     - On `stream_event`: extract text deltas → append to `partialText` → emit `event: delta`
     - On `tool_progress`: emit `event: tool`
     - On `assistant`: extract full text → persist to DB → clear `partialText`
     - On `result`: emit `event: done` with cost/usage
   - **Wrap iterator in try/catch**: on `AbortError` or stream close,
     persist `partialText` as assistant message if non-empty
4. Build `/api/conversations/route.ts` — GET (list only; creation is handled by `/api/chat`)
5. Build `/api/conversations/[id]/route.ts` — GET (with messages)
6. Build `src/hooks/useChat.ts`:
   - `sendMessage(text)` — POST to `/api/chat`, read SSE stream
   - `cancel()` — abort the fetch (triggers AbortController server-side)
   - Message state management (optimistic user message, streaming assistant)
   - On `event: init`, receive `conversationId` and call `router.replace()`
     (not `push`) to update the URL to `/chat/[id]`
   **Critical**: the stream reader must survive the route change.
   `useChat` is consumed via a `ChatStreamContext` provider in
   `/chat/layout.tsx` (the layout persists across child route changes).
   The page components (`/chat/page.tsx` and `/chat/[id]/page.tsx`)
   consume this context — they never own the stream directly.
7. Build `src/hooks/useAutoScroll.ts`
8. Build `src/components/chat/` — ChatView, MessageList, MessageBubble (with markdown), ChatInput (with send/stop toggle)
9. Build `src/components/chat/ChatStreamProvider.tsx` — context provider
   wrapping `useChat`. Placed in `/chat/layout.tsx`. Owns the fetch,
   stream reader, abort controller, and message state. Child routes
   read from context.
10. Build `/chat/page.tsx` — empty state with ChatInput only (consumes
   `ChatStreamContext`; typing the first message triggers creation
   via `/api/chat`, and `router.replace` updates URL on `event: init`)
11. Build `/chat/[id]/page.tsx` — loads existing conversation, renders
   ChatView (consumes `ChatStreamContext` for active streams, falls
   back to DB history on mount)

**Verify**: Send "hello" → see streaming response. Send "search the web for today's news" → see tool indicator → web results. Refresh page → conversation still there.

### Phase 3: Conversations + Sidebar

**Goal**: Multiple conversations, navigation between them.

1. Build `src/hooks/useConversations.ts` — list, create, delete, rename
2. Build `src/components/sidebar/` — Sidebar, ConversationItem
3. Build `/chat/layout.tsx` — responsive layout (sidebar + chat area)
4. Add conversation deletion (`DELETE /api/conversations/[id]`)
5. Add conversation rename (`PATCH /api/conversations/[id]`)
6. Auto-title: after first assistant response, set title = first 60 chars of user's first message
7. Mobile navigation: full-screen sidebar on mobile, back button in chat view

**Verify**: Create 3 conversations → switch between them → each resumes correctly. Delete one → it's gone. View on mobile → tap conversation → full-screen chat → back → list.

### Phase 4: Memory + Settings

**Goal**: Editable knowledge base that persists across conversations.

1. Build `/api/memory/route.ts` — GET (read), PUT (write)
2. Build `src/components/settings/MemoryEditor.tsx` — markdown textarea + save
3. Build `/settings/page.tsx`
4. Add settings link in sidebar
5. Verify memory injection: add a fact to memory → start new conversation → ask about it → agent knows it

**Verify**: Add "My dog's name is Rex" to memory → new conversation → "What's my dog's name?" → "Rex"

### Phase 5: PWA + Polish

**Goal**: Installable on phone, polished UX.

1. Create `public/manifest.json` — name, icons, display: standalone, theme_color
2. Create `public/sw.js` with a **split caching strategy**:
   - **Static assets** (JS, CSS, fonts, images): cache-first
     (content-hashed by Next.js, safe to cache aggressively)
   - **HTML / navigation requests**: network-first with offline fallback
     (a generic "You are offline" page). Never cache HTML — the root
     page redirects based on auth state, and cached HTML causes stale
     redirects and auth leakage.
   - **API routes**: network-only. Never cache authenticated responses.
   - Never cache responses with `Set-Cookie` headers or 3xx status codes.
3. Register SW in `layout.tsx`, add PWA meta tags
4. Generate icons (192x192, 512x512, apple-touch-icon)
5. Code block copy button in MessageBubble
6. Loading skeletons for conversation list and message history
7. Empty states (no conversations yet, new conversation)
8. Keyboard shortcut: Cmd/Ctrl+Shift+N for new conversation

**Verify**: Open on mobile Safari/Chrome → "Add to Home Screen" → opens as standalone app → chat works → close and reopen → still works.

## Dependencies

```json
{
  "dependencies": {
    "next": "^15.3",
    "react": "^19.1",
    "react-dom": "^19.1",
    "@anthropic-ai/claude-agent-sdk": "latest",
    "better-sqlite3": "^12.8",
    "drizzle-orm": "^0.45",
    "react-markdown": "^9.0",
    "rehype-highlight": "^7.0",
    "remark-gfm": "^4.0"
  },
  "devDependencies": {
    "typescript": "^5.8",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/better-sqlite3": "^7.6",
    "drizzle-kit": "^0.30",
    "tailwindcss": "^4.0",
    "@tailwindcss/postcss": "^4.0",
    "postcss": "^8.5",
    "eslint": "^9",
    "eslint-config-next": "^15.3"
  }
}
```

No `uuid` (use `crypto.randomUUID()`), no `bcrypt` (use `crypto.scrypt`),
no `next-auth`, no state library, no `socket.io`.

## Verification Checklist (end-to-end)

- [ ] `npm run dev` starts without errors
- [ ] First visit → `/setup` → set password → `/login` → authenticate → `/chat`
- [ ] Type message → streaming response appears token by token
- [ ] "Search the web for X" → tool indicator shows → results stream in
- [ ] Stop button cancels mid-stream
- [ ] Multiple conversations in sidebar, switch between them
- [ ] Refresh page → conversation history preserved
- [ ] Resume conversation → agent has context from prior messages
- [ ] Edit memory in settings → new conversation uses updated knowledge
- [ ] Mobile: full-screen navigation, installable as PWA
- [ ] Invalid password → error shown, not authenticated
- [ ] API routes return 401 without valid session cookie
