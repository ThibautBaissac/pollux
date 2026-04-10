# Pollux Codebase Review

Scope reviewed: auth/sessions, API handlers, SSE streaming, database usage, and client-side state/rendering.

Validation note: `npm test` passes (`85/85`), but the cases below are not covered by the current suite.

## Security

### Finding 1
- **File:line** `src/lib/agent.ts:98`
- **Severity** High
- **Category** Security
- **Description** The chat agent is started with `allowedTools` that include `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash`, plus `permissionMode: "dontAsk"`. That means any authenticated browser session can drive filesystem and shell access under the server account, and prompt-injected web content can influence those actions because web tools are enabled in the same agent. This also contradicts the README’s narrower tool description.
- **Suggestion** Put the agent behind a real sandbox and require explicit approval for shell/filesystem tools, or reduce the allowlist to the minimum needed.

### Finding 2
- **File:line** `src/app/api/auth/setup/route.ts:18`
- **Severity** High
- **Category** Security
- **Description** Instance ownership is decided by the first unauthenticated `POST /api/auth/setup`. There is no bootstrap secret or local-only guard, and the `isSetupComplete()` check is outside any transaction, so a public/shared-LAN deployment can be claimed or raced before the intended owner finishes setup.
- **Suggestion** Protect first-run setup with an out-of-band bootstrap secret or localhost-only policy and make the initialization atomic.

### Finding 3
- **File:line** `src/lib/rate-limit.ts:17`
- **Severity** High
- **Category** Security
- **Description** Auth rate limiting trusts `X-Forwarded-For` and `X-Real-IP` directly from the request. A direct client can spoof those headers and rotate bucket keys at will, bypassing the login/recovery/password-change throttles.
- **Suggestion** Derive the client key from trusted proxy metadata only, or ignore forwarded IP headers unless the app is behind a verified proxy.

### Finding 4
- **File:line** `src/app/api/settings/mcp/route.ts:14`
- **Severity** Medium
- **Category** Security
- **Description** The settings API returns `getMcpServers()` verbatim to the browser. `StoredMcpServer` supports `env` and `headers` fields, so MCP credentials can be exposed to client-side code even though the UI does not need to display them.
- **Suggestion** Redact secret material from `GET /api/settings/mcp` and treat sensitive MCP fields as write-only server-side config.

## Bug

### Finding 5
- **File:line** `src/lib/chat.ts:254`
- **Severity** Medium
- **Category** Bug
- **Description** The retry path for failed session resume clears `partialText` and `pendingToolUses` on the server, but it does not reset anything already streamed to the client. A resumed session that errors after emitting deltas can append a second attempt onto stale UI content. Separately, the fresh `msg.session_id` from the `init` event is never assigned back to `currentSessionId`, so new sessions that fail mid-stream do not benefit from the retry logic at all.
- **Suggestion** Update `currentSessionId` on `init`, and only retry before any client-visible output or emit a reset/restart event to the client.

### Finding 6
- **File:line** `src/app/api/conversations/[id]/route.ts:41`
- **Severity** Medium
- **Category** Bug
- **Description** `JSON.parse(m.toolUses)` is unguarded. One malformed `tool_uses` value from DB corruption, older data, or manual edits makes the entire conversation endpoint throw a 500 instead of degrading gracefully.
- **Suggestion** Parse `tool_uses` defensively and fall back to `null` or `[]` when the payload is invalid.

## Inconsistency

### Finding 7
- **File:line** `src/lib/db/schema.ts:13`
- **Severity** Low
- **Category** Inconsistency
- **Description** `text("role", { enum: ["user", "assistant"] })` is only a TypeScript-level hint for SQLite. The database does not enforce that constraint, so runtime rows can carry roles outside the declared union while the rest of the code assumes only `"user"` and `"assistant"` exist.
- **Suggestion** Add a database-level `CHECK` constraint and validate rows at read boundaries.

### Finding 8
- **File:line** `src/hooks/useChatStream.ts:181`
- **Severity** Low
- **Category** Inconsistency
- **Description** Live streaming tool badges are deduplicated by tool name, while persisted `tool_use` entries are stored per occurrence. If the same tool runs multiple times, the in-flight UI shows fewer tool uses than the final reloaded conversation.
- **Suggestion** Track tool calls with stable IDs or stop deduplicating live tool events by name.

### Finding 9
- **File:line** `src/app/api/memory/route.ts:6`
- **Severity** Low
- **Category** Inconsistency
- **Description** Unknown `file` values silently coerce to `"knowledge"` for both `GET` and `PUT` instead of returning a validation error. That diverges from the stricter request validation used in the other API routes and can write the wrong memory file on malformed requests.
- **Suggestion** Reject unknown `file` values with `400 Bad Request` rather than defaulting them.
