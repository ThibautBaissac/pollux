# Memory System Implementation Plan

Adapted from nanobot's memory architecture for Pollux's constraints:
single-user, local-first, Node.js/Next.js, Claude Agent SDK.

---

## Phase 1 — Three-file memory split

### Goal

Replace the single `data/memory/knowledge.md` with three scoped files:

| File | Purpose | Nanobot equivalent |
|------|---------|--------------------|
| `data/memory/profile.md` | User identity, preferences, how Pollux should behave | `USER.md` + `SOUL.md` |
| `data/memory/knowledge.md` | Facts, decisions, project context | `memory/MEMORY.md` |
| `data/memory/history.jsonl` | Append-only conversation summaries (Dream's input) | `memory/history.jsonl` |

Two files instead of three — Pollux has a fixed personality, so a separate
`SOUL.md` is unnecessary. Personality tuning lives as a section in `profile.md`.

### Changes

#### `src/lib/memory.ts`

Replace the current single-file module with a `MemoryStore` class that manages
all three files.

```typescript
// src/lib/memory.ts

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";

const MEMORY_DIR = join(process.cwd(), "data", "memory");

const DEFAULTS = {
  profile: `# Profile\n\nTell Pollux about yourself — name, preferences, communication style.\n`,
  knowledge: `# Knowledge Base\n\nFacts, decisions, and context Pollux should remember.\n`,
};

export type MemoryFile = "profile" | "knowledge";

export function readMemoryFile(file: MemoryFile): string { /* ... */ }
export function writeMemoryFile(file: MemoryFile, content: string): void { /* ... */ }

// Combines both files + recent unprocessed history into the system prompt injection.
// This mirrors nanobot's "Recent History" bridge (context.py:56-61): facts
// captured by the summarizer are visible in the live prompt immediately,
// without waiting for Dream to absorb them into the durable files.
const MAX_RECENT_HISTORY = 50;

export function readMemory(): string {
  const profile = readMemoryFile("profile");
  const knowledge = readMemoryFile("knowledge");

  // Unprocessed history = entries the summarizer wrote but Dream hasn't
  // consumed yet.  Inject them so the agent sees recent facts right away.
  const dreamCursor = getLastDreamCursor();
  const recent = readHistorySince(dreamCursor).slice(-MAX_RECENT_HISTORY);
  const recentSection = recent.length > 0
    ? `\n\n## Recent History\n${recent.map((e) => `- [${e.timestamp}] ${e.content}`).join("\n")}`
    : "";

  return `## User Profile\n${profile}\n\n## Knowledge Base\n${knowledge}${recentSection}`;
}

// history.jsonl operations (for Phase 2)
export interface HistoryEntry {
  cursor: number;
  timestamp: string;       // ISO-like: "2026-04-10 14:30"
  conversationId: string;
  content: string;
}

export function appendHistory(entry: Omit<HistoryEntry, "cursor">): number { /* ... */ }
export function readHistorySince(cursor: number): HistoryEntry[] { /* ... */ }
export function getLastDreamCursor(): number { /* ... */ }
export function setLastDreamCursor(cursor: number): void { /* ... */ }
```

The `readMemory()` function signature stays the same — `agent.ts` and
`route.ts` don't need changes beyond this.

#### `src/app/api/memory/route.ts`

Update GET/PUT to accept a `?file=profile|knowledge` query parameter.
Default to `knowledge` for backward compatibility with existing clients.

```typescript
// GET /api/memory?file=profile
// PUT /api/memory  { file: "profile", content: "..." }
```

#### `src/components/settings/MemoryEditor.tsx`

Replace the single textarea with a tabbed editor — two tabs ("Profile" and
"Knowledge Base"), each loading/saving its respective file. Reuse the existing
save logic per tab.

#### Migration

On first read, if `profile.md` doesn't exist but `knowledge.md` does, create
`profile.md` with the default content. No content migration — the user's
existing `knowledge.md` stays as-is.

---

## Phase 2 — Post-conversation summarizer

### Goal

After each conversation completes, extract key facts via an SDK `query()` call
and append them to `data/memory/history.jsonl`. This creates the input feed
that Dream (Phase 3) consumes.

### Design

The summarizer fires from the chat route when the agent stream emits a `result`
message. It runs via Next.js `after()` — the framework-blessed way to schedule
post-response work. `after()` hooks into the runtime's `waitUntil()` primitive,
so the callback completes even if the response has already been sent and the
request context would otherwise be torn down. A bare fire-and-forget promise
would be silently dropped in serverless or edge deployments and is unreliable
even under `next start` during graceful shutdown.

`after()` is stable since Next.js 15.1 (Pollux runs 16.2.3). No config needed.

#### `src/lib/summarizer.ts`

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { appendHistory } from "./memory";
import { db } from "./db";
import { messages as messagesTable } from "./db/schema";
import { eq } from "drizzle-orm";

const SUMMARIZER_PROMPT = `Extract key facts from this conversation. Only output items matching these categories, skip everything else:
- User facts: personal info, preferences, stated opinions, habits
- Decisions: choices made, conclusions reached
- Solutions: working approaches discovered, especially non-obvious methods
- Events: plans, deadlines, notable occurrences

Priority: user corrections and preferences > solutions > decisions > events.
Skip: anything trivially derivable from the conversation itself.
Output as concise bullet points, one fact per line. No preamble.
If nothing noteworthy happened, output exactly: (nothing)`;

export async function summarizeConversation(
  conversationId: string,
  sdkSessionId: string,
): Promise<void> {
  // 1. Read the conversation from the SDK session transcript.
  //
  //    getSessionMessages() returns SessionMessage[] where each message has
  //    `type: 'user' | 'assistant' | 'system'` and `message: unknown`.
  //    The `message` field is the raw Anthropic API object — its shape is
  //    not guaranteed by the SDK types.  We normalize defensively below.
  //
  //    Fallback: if the SDK transcript is unavailable (e.g. session was
  //    cleared or file is missing), fall back to Pollux's own DB messages.
  let formatted: string;

  try {
    const sdkMessages = await getSessionMessages(sdkSessionId, {
      dir: process.cwd(),
    });
    if (sdkMessages.length < 2) return;
    formatted = formatSdkMessages(sdkMessages);
  } catch {
    // Fallback: use our own DB messages
    const dbMessages = db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .all();
    if (dbMessages.length < 2) return;
    formatted = dbMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
  }

  // 2. Run a minimal SDK query — no tools, low budget
  const stream = query({
    prompt: `Summarize this conversation:\n\n${formatted}`,
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: SUMMARIZER_PROMPT,
      tools: [],                         // No tools needed
      permissionMode: "dontAsk",
      maxTurns: 1,
      maxBudgetUsd: 0.02,
      thinking: { type: "disabled" },    // Save tokens
    },
  });

  // 3. Collect the result
  let summary = "";
  for await (const msg of stream) {
    if (msg.type === "result" && msg.subtype === "success") {
      summary = msg.result;
    }
  }

  // 4. Skip if nothing noteworthy
  if (!summary || summary.trim() === "(nothing)") return;

  // 5. Append to history.jsonl
  appendHistory({
    timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    conversationId,
    content: summary,
  });
}

// ---------------------------------------------------------------------------
// SDK transcript normalization
// ---------------------------------------------------------------------------
//
// Each SessionMessage has `message: unknown`.  At runtime this is the raw
// Anthropic API message object.  We handle three shapes:
//
//   1. String content  → message.content is a string
//   2. Block array     → message.content is ContentBlock[] with .type/.text
//   3. Opaque / null   → skip
//
// We only care about user and assistant messages; system messages are skipped.

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface RawMessage {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

function formatSdkMessages(
  messages: Array<{ type: string; message: unknown }>,
): string {
  const lines: string[] = [];

  for (const entry of messages) {
    if (entry.type === "system") continue;

    const raw = entry.message as RawMessage | null;
    if (!raw) continue;

    const role = (raw.role ?? entry.type).toUpperCase();
    const text = extractText(raw.content);
    if (text) lines.push(`${role}: ${text}`);
  }

  return lines.join("\n");
}

function extractText(
  content: string | ContentBlock[] | undefined,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n");
  }
  return "";
}
```

#### Integration in `src/app/api/chat/route.ts`

Use `after()` from `next/server` to schedule the summarizer. The callback
runs after the response finishes streaming and is kept alive by the runtime.

```typescript
import { after } from "next/server";
import { summarizeConversation } from "@/lib/summarizer";

// ... inside the POST handler, at the top level (not inside the stream) ...

} else if (msg.type === "result") {
  emit("done", {
    costUsd: msg.total_cost_usd,
    turns: msg.num_turns,
  });

  // Capture values for the after() closure
  const sessionId = msg.session_id;
  const turns = msg.num_turns;

  // Schedule durable post-response work via after().
  // Unlike a bare promise, after() hooks into waitUntil() so the
  // callback completes even after the response is sent.
  after(async () => {
    if (sessionId && turns >= 2) {
      try {
        await summarizeConversation(finalConvId, sessionId);
      } catch (err) {
        console.error("Summarizer failed:", err);
      }
    }
  });
}
```

> **Why `after()`, not a bare promise?** Next.js can tear down request context
> once the response is sent. `after()` (stable since 15.1, imported from
> `next/server`) tells the framework to keep the request alive until the
> callback settles. It delegates to the platform's `waitUntil()` under the
> hood. A fire-and-forget promise is silently dropped in serverless runtimes
> and unreliable even under `next start` during shutdown.

#### Cost control

- Model: `claude-sonnet-4-6` (cheapest capable model)
- `maxTurns: 1` — single LLM call, no tool use
- `maxBudgetUsd: 0.02` — hard ceiling
- `thinking: { type: "disabled" }` — no extended thinking
- Skip conversations with fewer than 2 turns
- Estimated cost: ~$0.005 per conversation summary

#### `history.jsonl` format

One JSON object per line, matching nanobot's format:

```json
{"cursor":1,"timestamp":"2026-04-10 14:30","conversationId":"abc-123","content":"- User prefers dark mode\n- Decided to use PostgreSQL for the side project"}
```

Cursor is auto-incrementing. A `.dream_cursor` file tracks how far Dream has
processed.

---

## Phase 3 — Dream (scheduled two-phase memory editor)

### Goal

Periodically process unread `history.jsonl` entries, analyze them against
current memory files, and make surgical edits. Optionally commit changes
with git for rollback.

### Design

Dream runs as an in-process timer (`setInterval`) in the Next.js server, not
as an external cron job. It uses the Claude Agent SDK's `query()` with
`tools: ['Read', 'Edit']` so the LLM can read and edit memory files directly.

#### `src/lib/dream.ts`

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  readMemoryFile,
  readHistorySince,
  getLastDreamCursor,
  setLastDreamCursor,
} from "./memory";

const MAX_BATCH_SIZE = 20;

const PHASE1_PROMPT = `Compare conversation history against current memory files. Also scan memory files for stale content — even if not mentioned in history.

Output one line per finding:
[PROFILE] atomic fact about the user (not already in memory)
[KNOWLEDGE] atomic fact, decision, or project context
[PROFILE-REMOVE] reason for removal
[KNOWLEDGE-REMOVE] reason for removal

Rules:
- Atomic facts: "prefers TypeScript over JavaScript" not "discussed programming"
- Corrections replace old facts: [PROFILE] location is Tokyo, not Osaka
- Flag stale content: passed deadlines, completed tasks, superseded decisions
- Do not add: transient status, temporary errors, conversational filler

[SKIP] if nothing needs updating.`;

const PHASE2_PROMPT = `Update memory files based on the analysis below.
- [PROFILE] / [KNOWLEDGE] entries: add content to the appropriate file
- [*-REMOVE] entries: delete the corresponding content

File paths (relative to cwd):
- data/memory/profile.md
- data/memory/knowledge.md

Editing rules:
- Use the Edit tool for surgical changes — never rewrite entire files
- Read a file first if you need to see its current content
- Batch changes to the same file when possible
- For deletions: match the exact text to remove
- If nothing to update, stop without using tools

Quality:
- Every line must carry standalone value
- Concise bullets under clear markdown headers
- When uncertain, keep the fact but append "(verify)"`;

export async function runDream(): Promise<{
  processed: number;
  skipped: boolean;
}> {
  // 1. Read unprocessed history
  const lastCursor = getLastDreamCursor();
  const entries = readHistorySince(lastCursor);

  if (entries.length === 0) {
    return { processed: 0, skipped: true };
  }

  const batch = entries.slice(0, MAX_BATCH_SIZE);

  // 2. Build context for Phase 1
  const historyText = batch
    .map((e) => `[${e.timestamp}] ${e.content}`)
    .join("\n");

  const currentProfile = readMemoryFile("profile");
  const currentKnowledge = readMemoryFile("knowledge");

  const context = [
    `## Conversation History\n${historyText}`,
    `## Current profile.md (${currentProfile.length} chars)\n${currentProfile}`,
    `## Current knowledge.md (${currentKnowledge.length} chars)\n${currentKnowledge}`,
  ].join("\n\n");

  // 3. Phase 1: Analyze (single LLM call, no tools)
  let analysis = "";
  const phase1 = query({
    prompt: context,
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: PHASE1_PROMPT,
      tools: [],
      permissionMode: "dontAsk",
      maxTurns: 1,
      maxBudgetUsd: 0.02,
      thinking: { type: "disabled" },
    },
  });

  for await (const msg of phase1) {
    if (msg.type === "result" && msg.subtype === "success") {
      analysis = msg.result;
    }
  }

  // 4. If nothing to update, advance cursor and return
  if (!analysis || analysis.trim() === "[SKIP]") {
    setLastDreamCursor(batch[batch.length - 1].cursor);
    return { processed: batch.length, skipped: true };
  }

  // 5. Phase 2: Edit files via SDK agent with Read + Edit tools
  const phase2Context = [
    `## Analysis Result\n${analysis}`,
    `## Current profile.md\n${currentProfile}`,
    `## Current knowledge.md\n${currentKnowledge}`,
  ].join("\n\n");

  const phase2 = query({
    prompt: phase2Context,
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: PHASE2_PROMPT,
      tools: ["Read", "Edit"],
      allowedTools: ["Read", "Edit"],
      permissionMode: "acceptEdits",
      maxTurns: 5,
      maxBudgetUsd: 0.05,
      thinking: { type: "disabled" },
      cwd: process.cwd(),
    },
  });

  for await (const msg of phase2) {
    if (msg.type === "result") {
      console.log(
        `Dream Phase 2: ${msg.subtype}, turns=${msg.num_turns}, cost=$${msg.total_cost_usd}`
      );
    }
  }

  // 6. Advance cursor
  setLastDreamCursor(batch[batch.length - 1].cursor);

  // 7. Git commit (if git versioning enabled)
  await gitCommitMemory(batch[batch.length - 1].timestamp);

  return { processed: batch.length, skipped: false };
}
```

#### Scheduler: `src/instrumentation.ts`

Next.js provides `instrumentation.ts` with an exported `register()` function
that runs exactly once when the server process starts — before any request is
handled. This is the officially supported location for background work like
`setInterval`. It is stable since Next.js 15.0 (Pollux runs 16.2.3).

The previous design (importing a scheduler from a route handler module) only
deduplicates per process via a module-level `started` flag. That fails in two
ways: (1) in dev mode, hot-reload re-evaluates the module and creates duplicate
timers; (2) the timer only starts on first request to that route, not at server
startup, so Dream may never run if no chat request is made.

`register()` avoids both problems.

```typescript
// src/instrumentation.ts

export function register() {
  // Only run in the Node.js runtime (this file also executes in Edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Guard against duplicate timers during dev hot-reload.
  // globalThis persists across re-evaluations; a module-level let does not.
  const g = globalThis as Record<string, unknown>;
  if (g.__polluxDreamStarted) return;
  g.__polluxDreamStarted = true;

  const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Dynamic import — register() runs before route modules are loaded,
  // so static imports of app code may not resolve yet.
  const start = async () => {
    const { runDream } = await import("./lib/dream");

    // Run once shortly after startup
    setTimeout(() => {
      runDream().catch((err: unknown) => console.error("Dream failed:", err));
    }, 30_000);

    // Then every 2 hours
    setInterval(() => {
      runDream().catch((err: unknown) => console.error("Dream failed:", err));
    }, INTERVAL_MS);
  };

  start().catch((err) => console.error("Dream scheduler init failed:", err));
}
```

No import needed in route files — Next.js discovers `src/instrumentation.ts`
automatically by convention.

#### Git versioning: `src/lib/git-memory.ts`

Lightweight git operations using shell commands (no extra dependencies).
Only commits memory files — not the whole repo.

```typescript
import { execSync } from "child_process";
import { join } from "path";

const MEMORY_DIR = join(process.cwd(), "data", "memory");
const TRACKED_FILES = ["profile.md", "knowledge.md"];

export async function gitCommitMemory(timestamp: string): Promise<string | null> {
  try {
    // Check if there are changes to memory files
    const status = execSync(
      `git -C "${MEMORY_DIR}" status --porcelain ${TRACKED_FILES.join(" ")}`,
      { encoding: "utf-8" },
    ).trim();

    if (!status) return null;

    // Stage and commit
    for (const f of TRACKED_FILES) {
      execSync(`git -C "${MEMORY_DIR}" add "${f}"`, { stdio: "ignore" });
    }
    execSync(
      `git -C "${MEMORY_DIR}" commit -m "dream: ${timestamp}" --author="pollux <pollux@local>"`,
      { encoding: "utf-8" },
    );

    return execSync(`git -C "${MEMORY_DIR}" rev-parse --short HEAD`, {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

export function initMemoryGit(): void {
  try {
    execSync(`git -C "${MEMORY_DIR}" rev-parse --git-dir`, { stdio: "ignore" });
  } catch {
    execSync(`git init "${MEMORY_DIR}"`, { stdio: "ignore" });
    // .gitignore: only track memory files
    const ignore = "*\n!profile.md\n!knowledge.md\n!.gitignore\n";
    require("fs").writeFileSync(join(MEMORY_DIR, ".gitignore"), ignore);
    execSync(`git -C "${MEMORY_DIR}" add .gitignore`, { stdio: "ignore" });
    execSync(
      `git -C "${MEMORY_DIR}" commit -m "init: pollux memory store" --author="pollux <pollux@local>"`,
      { stdio: "ignore" },
    );
  }
}
```

Initialize git from `src/lib/db/index.ts` (alongside the existing
`mkdirSync("data/memory")` call):

```typescript
import { initMemoryGit } from "../git-memory";
// ... existing db setup ...
initMemoryGit();
```

---

## File inventory

New files:

| File | Phase | Purpose |
|------|-------|---------|
| `src/lib/summarizer.ts` | 2 | Post-conversation fact extraction + SDK transcript normalization |
| `src/lib/dream.ts` | 3 | Two-phase memory editor |
| `src/instrumentation.ts` | 3 | Dream scheduler via Next.js `register()` hook |
| `src/lib/git-memory.ts` | 3 | Git operations for memory versioning |

Modified files:

| File | Phase | Change |
|------|-------|--------|
| `src/lib/memory.ts` | 1 | Multi-file store + history.jsonl + recent history bridge |
| `src/app/api/memory/route.ts` | 1 | `?file=` query param support |
| `src/components/settings/MemoryEditor.tsx` | 1 | Tabbed editor (Profile / Knowledge) |
| `src/lib/agent.ts` | 1 | System prompt uses combined `readMemory()` |
| `src/app/api/chat/route.ts` | 2 | Schedule summarizer via `after()` on result |
| `src/lib/db/index.ts` | 3 | Call `initMemoryGit()` on startup |

No changes:

| File | Reason |
|------|--------|
| `src/lib/db/schema.ts` | No new tables — memory is file-based |
| `src/lib/auth.ts` | Memory doesn't touch auth |
| `next.config.ts` | No new external packages to exclude |
| `package.json` | No new dependencies (git via shell, SDK already present) |

---

## Implementation order

```
Phase 1 (memory split)        ← Do first, unlocks Phase 2 + 3
  ├── memory.ts rewrite
  ├── API route update
  ├── MemoryEditor tabs
  └── Migration logic

Phase 2 (summarizer)           ← Do second, feeds Phase 3
  ├── summarizer.ts
  └── chat route integration

Phase 3 (Dream)                ← Do last, consumes Phase 2 output
  ├── dream.ts
  ├── instrumentation.ts (register() scheduler)
  ├── git-memory.ts
  └── db/index.ts wiring for initMemoryGit()
```

Each phase is independently useful:
- Phase 1 alone gives structured memory with a better editing UX
- Phase 1 + 2 gives automatic fact capture (visible in `history.jsonl`)
- Phase 1 + 2 + 3 gives self-maintaining memory with versioned rollback

---

## Cost estimates

| Operation | Frequency | Est. cost |
|-----------|-----------|-----------|
| Summarizer | Per conversation (~5/day) | ~$0.005 each = $0.025/day |
| Dream Phase 1 | Every 2 hours (12/day) | ~$0.005 each = $0.06/day |
| Dream Phase 2 | Only when changes needed (~3/day) | ~$0.02 each = $0.06/day |
| **Total** | | **~$0.15/day** |

All operations use `claude-sonnet-4-6` with thinking disabled and tight budget
caps. The summarizer and Dream Phase 1 skip early when there's nothing to
process.

---

## SDK usage notes

Both the summarizer and Dream use the Claude Agent SDK's `query()` function
rather than raw API calls:

- **Summarizer**: `query()` with `tools: []`, `maxTurns: 1` — effectively a
  single LLM call, but through the SDK so it inherits session management,
  cost tracking, and error handling.

- **Dream Phase 1**: Same as summarizer — toolless single-turn query.

- **Dream Phase 2**: `query()` with `tools: ['Read', 'Edit']`,
  `permissionMode: 'acceptEdits'`, `maxTurns: 5`. The SDK agent reads and
  edits memory files directly using its built-in file tools. This is the
  direct equivalent of nanobot's `AgentRunner` with `ReadFileTool` /
  `EditFileTool`, but using the SDK's built-in tools instead of custom ones.

- **Conversation reading**: `getSessionMessages()` from the SDK reads the
  session transcript for the summarizer. This avoids duplicating message
  storage — the SDK already persists full transcripts.

### `SessionMessage.message` normalization

`getSessionMessages()` returns `SessionMessage[]` where `message` is typed as
`unknown` (sdk.d.ts:2915). At runtime the field holds the raw Anthropic API
message object — either a string `content` or a `ContentBlock[]` array with
`{ type: "text", text: "..." }` entries. Tool-use blocks, images, and thinking
blocks also appear but are not relevant for summarization.

The summarizer must normalize defensively:

1. Skip entries where `type === "system"` (compact boundaries, notices).
2. For user/assistant entries, cast `message` to `{ role?: string; content?: string | ContentBlock[] }`.
3. If `content` is a string, use it directly.
4. If `content` is an array, filter to `type === "text"` blocks and join their `.text` fields.
5. If `content` is missing or unrecognizable, skip the entry.

A fallback path reads from Pollux's own `messages` table in SQLite if the SDK
transcript is unavailable (session cleared, file missing, etc.).

See the `formatSdkMessages()` and `extractText()` helpers in `src/lib/summarizer.ts`.

---

## What this skips (and why)

| Nanobot feature | Decision | Rationale |
|-----------------|----------|-----------|
| Consolidator | Skip | SDK manages its own context window |
| `SOUL.md` separate file | Skip | Pollux has fixed personality; tune via `profile.md` section |
| Dream `/dream` commands | Defer | Add UI later if git versioning proves useful |
| `dulwich` (pure git) | Skip | Shell `git` is simpler and already available |
| Legacy migration | Skip | No legacy format to migrate from |
| Cursor file compaction | Skip | Single-user; `history.jsonl` won't grow fast enough to matter |
| Dream `maxIterations` safety | Covered | SDK's `maxTurns` + `maxBudgetUsd` serve the same purpose |
