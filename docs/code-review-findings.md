# Pollux Code Review — Findings

**Scope:** Auth & sessions, API route handlers, SSE streaming, database, client-side rendering.
**Date:** 2026-04-12
**Mode:** Read-only review. No code modified.

Severity scale:
- **Critical** — exploitable vulnerability or data-loss bug reachable under normal use.
- **High** — real bug or security weakness; exploitation requires plausible conditions.
- **Medium** — correctness issue with user-visible impact, or defense-in-depth gap.
- **Low** — minor defect, hardening opportunity, or inconsistency with small impact.

---

## Security

### 1. MCP secret corruption on save — `src/components/settings/McpServersEditor.tsx:53-73`, `src/app/api/settings/mcp/route.ts:10-29`
**Severity:** High  
**Category:** Security / Bug  
**Description:** `GET /api/settings/mcp` redacts `env` and `headers` to the literal string `"********"` before returning them. The client (`McpServersEditor`) loads that redacted map into state and, on any later change (add/remove), sends the entire map back via `PUT`. `setMcpServers` writes it verbatim, so real secrets are silently overwritten with `"********"`. After the PUT, any MCP server relying on those env vars or headers will fail or leak the placeholder on the wire. The UI currently does not even surface env/headers editing, so users have no obvious way to recover them.  
**Suggestion:** Either (a) keep a server-side "edit token" that lets the client omit redacted fields while preserving the stored originals, or (b) require per-server PATCH semantics so redacted values are never round-tripped. At minimum, detect `"********"` on write and refuse/ignore.

### 2. Session token plaintext-fallback weakens hash defense — `src/lib/auth.ts:82-104`
**Severity:** Medium  
**Category:** Security  
**Description:** `validateSession` queries `WHERE sessions.token = sha256(cookie) OR sessions.token = cookie`. The plaintext-match branch exists to upgrade legacy sessions, but since stored tokens are now hashes, an attacker with read access to the `sessions` table (e.g., a filesystem backup or a SQL-injection primitive elsewhere) can use the stored hash string directly as the session cookie and authenticate. That turns the DB column from a one-way verifier back into a reusable credential. Low likelihood in a local-only deployment, but it cancels the entire benefit of hashing session tokens at rest.  
**Suggestion:** Drop the plaintext-fallback branch; migrate any unhashed row once via a startup task, then only match on `sha256(cookie)`.

### 3. CSRF protection relies on `sec-fetch-site` with permissive fallback — `src/lib/request-guards.ts:5-24`
**Severity:** Medium  
**Category:** Security  
**Description:** `requireTrustedRequest` blocks cross-site requests only if the browser sends a `sec-fetch-site` header with an explicit cross-site value. When the header is absent (older browsers, curl, or crafted fetches from extensions) the check returns `null` (allowed). The `origin` check then only fires if Origin is present and non-matching. Combined with `SameSite=lax` cookies this is reasonable for same-origin browser flows, but there is no CSRF token, no Origin-required policy, and no double-submit cookie. Any future relaxation (e.g., enabling CORS) would immediately open CSRF.  
**Suggestion:** For any state-changing route, require either a custom header (e.g., `X-Requested-With`) set by the client, a CSRF token, or a strictly matching Origin header. Treat missing `sec-fetch-site` as untrusted.

### 4. Recovery code verification burns scrypt per attempt — `src/lib/auth.ts:219-242`
**Severity:** Low  
**Category:** Security  
**Description:** `verifyRecoveryCode` iterates every unused code (up to 8) and runs `scrypt` per row. An attacker submitting wrong codes triggers N scrypt computations per request — a CPU amplification vector. Mitigated by the `recover` rate limit (10/15min) but still ~80 scrypts per window. Also, recovery codes contain 16 hex chars = 64 bits of entropy; with 8 simultaneously-valid codes, brute-force surface is 8·2⁶⁴ — fine, but tight given unlimited online attempts if rate limit is bypassed.  
**Suggestion:** Store a short per-code lookup prefix (e.g., first 8 hex chars in a separate index column), so verification fetches one candidate row and runs scrypt once. Alternatively, salt each recovery code with a deterministic index known by the user.

### 5. Reminder error messages leaked verbatim — `src/app/api/reminders/route.ts:92-95`
**Severity:** Low  
**Category:** Security  
**Description:** `createReminder` can throw FK-constraint errors, cron-parser errors, or SQLite native errors. The POST handler forwards `err.message` to the client with status 400. This can reveal library internals or schema details (e.g., `FOREIGN KEY constraint failed`, table names). Same pattern in `gitCommitMemory`'s `execSync` errors passed through logs.  
**Suggestion:** Map known error classes to user-safe messages; log the raw error server-side only.

### 6. `git-memory` shell-interpolates a timestamp — `src/lib/git-memory.ts:22-25`
**Severity:** Low  
**Category:** Security (defense-in-depth)  
**Description:** The commit message is built with string interpolation: `git commit -m "dream: ${timestamp}"`. The timestamp is currently generated server-side in `memory.ts` (`new Date().toISOString().slice(...)`), so it is trusted. However, the pattern is fragile: any future change that lets history entries flow from LLM output, user input, or a file on disk could produce a shell-injection sink. `MEMORY_DIR` is similarly interpolated.  
**Suggestion:** Use `spawnSync("git", ["-C", MEMORY_DIR, "commit", "-m", `dream: ${timestamp}`, ...])` with an argument array; never pass user-adjacent data through a shell string.

### 7. MCP stdio servers run unrestricted commands under the app user — `src/lib/mcp-store.ts:54-91`
**Severity:** Low (documented / by-design)  
**Category:** Security  
**Description:** Authenticated users can register an MCP server of type `stdio` with arbitrary `command` + `args` that the Agent SDK spawns on every chat request. This is effectively RCE-by-design for the owner. Noted here because if Pollux is ever exposed beyond localhost, this becomes a privilege-escalation vector for anyone who steals a session cookie.  
**Suggestion:** Document the trust boundary explicitly (single-user, localhost-only). If remote exposure is ever considered, add a confirmation step or a signed manifest for MCP configs.

---

## Bugs

### 8. SSE `init` title overwrites stored title in the UI — `src/lib/chat.ts:19-58`, `src/hooks/useChat.ts:250-254`
**Severity:** Medium  
**Category:** Bug / Inconsistency  
**Description:** `resolveConversation` always computes `title = messageText.slice(0, 60)` and returns it in the SSE `init` event, **even for existing conversations whose stored title is different**. The client unconditionally calls `setTitle(event.title)`, so as soon as the user sends a new message in an existing conversation, the header updates to a snippet of the new message. The sidebar list (fetched from `GET /api/conversations`) still shows the real title, producing a visible mismatch until navigation.  
**Suggestion:** In `resolveConversation`, return the existing `conv.title` for found conversations; only compute a snippet when creating a new conversation. Alternatively, emit `title` only on creation.

### 9. Tool uses streamed to client lose their `input` payload — `src/lib/chat.ts:215-220`, `src/hooks/useChat.ts:269-273`, `src/components/chat/MessageBubble.tsx:21-65`
**Severity:** Medium  
**Category:** Bug / Inconsistency  
**Description:** The server's SSE `tool` event carries only `{name, status, elapsed}`, and the client's `applyToolUse` stores `{name}` only. `MessageBubble.formatToolLabel` needs `input.file_path`, `input.command`, `input.pattern`, etc., to render meaningful labels — so during live streaming every tool chip degrades to the bare tool name. The persisted row in `messages.toolUses` contains full input, so after a reload or snapshot refetch the labels suddenly populate, which is jarring.  
**Suggestion:** Include `input` in the SSE `tool` event payload and in `SseToolEvent`, or suppress tool chips until the final `assistant` frame persists the message.

### 10. SSE parser `JSON.parse` can crash the reader — `src/hooks/useChatStream.ts:57-60`
**Severity:** Medium  
**Category:** Bug  
**Description:** `parseLines` calls `JSON.parse(line.slice(6))` with no try/catch. A malformed frame (e.g., a network truncation that splits mid-JSON, or a future server-side bug) throws inside the async generator and terminates it. The hook catches it as an unknown error and leaves the stream in an error state, but any queued deltas are dropped. Buffer handling in `parseSseStream` also splits on `\n` without respecting the SSE `\n\n` record separator — a `data:` line with an embedded newline (not currently emitted, but legal per spec) would break.  
**Suggestion:** Wrap the parse in try/catch and skip malformed lines; optionally switch to splitting on `\n\n` for record boundaries.

### 11. `createChatStream` abort listener never removed — `src/lib/chat.ts:122-124`, `src/lib/chat.ts:282-284`
**Severity:** Low  
**Category:** Bug (leak)  
**Description:** `abortSignal.addEventListener("abort", ..., { once: true })` attaches a listener to the request's signal for the lifetime of the stream. When the stream completes normally, `controller.abort()` is never called and the listener stays registered until the request signal itself is GC'd. In practice the request-scoped signal is short-lived, so this leaks at most one closure per request, but it's avoidable.  
**Suggestion:** After the `while` loop exits, call `abortSignal.removeEventListener("abort", ...)` with a named handler, or abort the inner controller unconditionally on close.

### 12. `resolveConversation` trusts any client-supplied conversation ID — `src/lib/chat.ts:26-50`
**Severity:** Low  
**Category:** Bug  
**Description:** When `conversationId` is passed in the POST body and `createIfMissing=true`, the handler inserts a row with the client's raw string as primary key. No UUID validation, no length cap, no character whitelist. SQLite will happily store a 10 MB string. In single-user mode this is not a privilege issue, but it lets a confused client create garbage rows that then cascade into `messages` and `reminders`.  
**Suggestion:** Validate `conversationId` matches a UUID regex or enforce a hard length cap before insert.

### 13. MCP `PUT` response returns unredacted secrets — `src/app/api/settings/mcp/route.ts:57-65`
**Severity:** Low  
**Category:** Bug  
**Description:** On successful `PUT`, the handler responds with `getMcpServers()` (raw, including env/headers). On `GET` the same data would be redacted. The client just sent these values so nothing new is leaked, but the inconsistency also means the client state after save diverges from the state it would see after a page reload. Combined with finding #1, it reinforces the round-trip corruption.  
**Suggestion:** Apply `redactSecrets` to the `PUT` response.

### 14. Reminder "once" scheduler crashes on empty datetime — `src/components/settings/RemindersManager.tsx:83-86`
**Severity:** Low  
**Category:** Bug  
**Description:** `new Date(scheduledAt).toISOString()` throws `RangeError: Invalid time value` when `scheduledAt` is empty or unparseable. The outer try/catch swallows it and reports "Network error" — misleading UX and harder to debug.  
**Suggestion:** Validate `scheduledAt` client-side before submission and surface a specific message.

### 15. `checkDueReminders` `busyConvs` built outside the transaction — `src/lib/reminders.ts:200-214`
**Severity:** Low  
**Category:** Bug (race)  
**Description:** The set of conversations with a running agent reminder is computed via a SELECT *before* the transaction begins, then consulted inside the tx. Between the SELECT and the tx, another scheduler tick (or `runScheduledAgent` clearing its flag) could mutate `runningSince`. With the 60 s tick interval and the `instrumentation.ts` single-chain scheduler this is unreachable in practice, but the invariant is guarded only by the process being single-threaded.  
**Suggestion:** Move the busy-conv query inside the transaction.

### 16. `safeParseToolUses` returns `unknown[]` cast as `ToolUse[]` — `src/app/api/conversations/[id]/route.ts:8-15`, `src/types/index.ts:10-13`
**Severity:** Low  
**Category:** Bug (type unsafety)  
**Description:** `safeParseToolUses` only checks `Array.isArray`; the inner shape is never validated. `GET /api/conversations/:id` returns the array as `toolUses`, typed on the client as `ToolUse[]`. If the stored JSON is corrupt (e.g., partial write during a crash) the UI will crash in `formatToolLabel` reading `.file_path` off a non-object.  
**Suggestion:** Validate each entry has a string `name`; drop malformed entries.

---

## Inconsistencies

### 17. Rate limiting uses a single shared bucket — `src/lib/rate-limit.ts:16-20`
**Severity:** Low  
**Category:** Inconsistency (by-design)  
**Description:** `getClientKey` always returns `"local"`, so every request — regardless of source — shares one bucket per limit key. Documented as intentional for a local-first app, but the comment at line 17 explicitly acknowledges the assumption. If the app is ever run behind a reverse proxy that forwards real IPs, the current implementation will still ignore them.  
**Suggestion:** No change needed now; add a check so that binding to `0.0.0.0` or a non-localhost host surfaces a warning.

### 18. `SseToolEvent` / `SseDoneEvent` types omit server-sent fields — `src/hooks/useChatStream.ts:21-34`, `src/lib/chat.ts:215-225`
**Severity:** Low  
**Category:** Inconsistency  
**Description:** Server emits `{name, status, elapsed}` for `tool` and `{costUsd, turns}` for `done`, but the TS types declare `{name}` and `{}` respectively. Fields are silently dropped by `mapEvent`. Either the server over-emits or the client under-consumes; right now the UI has no place to display cost/turns or tool status.  
**Suggestion:** Align the types with the wire payload, then decide whether to surface or drop at a single site.

### 19. Error-response shape varies across routes — across `src/app/api/**`
**Severity:** Low  
**Category:** Inconsistency  
**Description:** Most routes return `{ error: string }`. Some routes also include validation detail only in the message, others short-circuit with `{ success: true }`. There's no stable machine-readable code (e.g., `code: "SETUP_COMPLETE"`), so client code compares on status + string. The setup/login flows, for instance, return status 400 with "Setup not complete" in some places and 400 with "Setup already complete" in others — client distinguishes via message content.  
**Suggestion:** Add a stable `code` field on error responses; keep `error` for human text.

### 20. Auth endpoints mix rate-limit positioning — `src/app/api/auth/login/route.ts` vs `src/app/api/auth/setup/route.ts`
**Severity:** Low  
**Category:** Inconsistency  
**Description:** `login/route.ts` checks `getPasswordHash()` *before* the rate limiter, so unauthenticated "setup not complete" probes never count against the bucket. `setup/route.ts` checks `isSetupComplete()` first for the same reason. Harmless but means the limit key names are subtly misleading (they count "attempts after basic preconditions"). In `recover` the order is also precondition-then-limit.  
**Suggestion:** Decide on a convention (usually: rate-limit first, precondition second) and apply consistently.

### 21. `persistAssistantMessage` is invoked from multiple owners — `src/lib/chat.ts`, `src/lib/scheduled-agent.ts`, `src/lib/reminders.ts`
**Severity:** Low  
**Category:** Inconsistency  
**Description:** Three different call sites insert assistant messages into the same conversation with no coordination. The code comment in `reminders.ts:278-281` flags that agent veilles can corrupt a shared SDK session if they race with user chat; the mitigation is scoped to reminder-vs-reminder only, not reminder-vs-chat. A user sending a message to a conversation that has an in-flight veille will interleave assistant rows and may resume from a stale `sdkSessionId`.  
**Suggestion:** Gate user chat on `conv.sdkSessionId` busy state (mirror the `runningSince` pattern) or serialize per-conversation through a queue.

---

## Out-of-scope observations (worth capturing)

- **`data/memory` git repo shares the app's working tree only when `cwd = repo root`.** `gitCommitMemory` operates on `MEMORY_DIR` independently, which is correct; just note that moving `data/memory` via symlink breaks `initMemoryGit`'s idempotency check.
- **`mkdirSync("data/memory")` is called at module import (`src/lib/db/index.ts:6`).** Side-effects on import work for server code but surprise tests; the Vitest suite already handles this via `process.cwd` mocking.
- **`useChat.sendMessage` uses `crypto.randomUUID()`** before knowing if the server will accept the request. On rejection, the client-generated ID is never persisted — good. But if two tabs issue `sendMessage` for the same conversation concurrently, the server processes both, and the SDK `resume` race noted above applies.
