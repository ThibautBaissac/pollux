# Agent Capabilities — Investigation Report

**Date:** 2026-04-10
**Scope:** Code/shell execution, filesystem tools, subagent spawning, MCP integration
**Reference:** docs/nanobot-feature-gap.md (Agent Capabilities section)

---

## Critical Finding: SDK Already Has Everything Built In

Nanobot implements all four features from scratch — custom tool classes, custom execution loops, custom MCP client — because it uses the raw Anthropic API. **Pollux uses the Claude Agent SDK, which provides all four as built-in capabilities.** This dramatically reduces scope.

| Feature | Nanobot | Pollux (via SDK) |
|---------|---------|------------------|
| Shell execution | Custom `ExecTool` class, 300+ lines | Built-in `Bash` tool — add to `allowedTools` |
| Filesystem | Custom `ReadFileTool`, `WriteFileTool`, `EditFileTool`, `ListDirTool` | Built-in `Read`, `Write`, `Edit`, `Glob`, `Grep` |
| MCP servers | Custom `MCPToolWrapper`, transport management, 400+ lines | Native `mcpServers` option in `query()` |
| Subagents | Custom `SubagentManager`, message bus, `SpawnTool` | Native `agents` option + `Agent` tool |

**Proof it works:** `dream.ts` already uses `allowedTools: ["Read", "Edit"]` with the SDK to edit memory files. The pattern is validated.

---

## Feature 1: Filesystem Tools

### How nanobot does it
- `nanobot/agent/tools/filesystem.py`: Four tool classes (`ReadFileTool`, `WriteFileTool`, `EditFileTool`, `ListDirTool`) inheriting from `_FsTool`
- Path restriction via `_resolve_path()` — resolves `..` traversals, enforces `allowed_dir` boundary
- Write/edit locked to `allowed_dir` only; extra dirs are read-only
- Read: 2000-line default, 128KB hard cap. Edit: fuzzy line matching for whitespace tolerance
- Glob + Grep as separate search tools

### What Pollux already has
- `agent.ts:32`: `allowedTools: ["WebSearch", "WebFetch"]` — filesystem tools excluded but SDK supports them
- `dream.ts:244`: Already uses `allowedTools: ["Read", "Edit"]` — proves the SDK integration works
- `permissionMode: "dontAsk"` — auto-approves tools in the allowed list, denies everything else
- `ToolUse` type only stores `{ name }` — no input/output data for rendering

### What's needed
- **Agent config**: Add `Read`, `Glob`, `Grep` to `allowedTools` (read-only first). Later add `Write`, `Edit`.
- **System prompt**: Describe available filesystem capabilities
- **Tool data model**: Extend `ToolUse` to include `input` and `output` for rich rendering
- **UI**: Render file contents, search results, edit diffs in MessageBubble (collapsible blocks)
- **Security**: The SDK's `cwd` option already scopes operations. `permissionMode: "dontAsk"` means no user prompt — acceptable for single-user local app. Consider whether to restrict to `cwd` only or allow broader access.

### Security considerations
- Single-user local app — the user already has full filesystem access
- SDK respects `cwd` as working directory
- Write operations are the main risk — could be gated behind a separate toggle in settings
- No secrets exposure risk beyond what the user already has access to

---

## Feature 2: Code / Shell Execution

### How nanobot does it
- `nanobot/agent/tools/shell.py`: `ExecTool` class with extensive security model
- **Blocklist**: `rm -rf`, `del /q`, `format`, `mkfs`, `dd`, `shutdown`, `reboot`, fork bombs
- **Sandbox**: Optional bubblewrap (Linux) — namespace isolation, read-only system dirs
- **Timeout**: Default 60s, max 600s
- **Output truncation**: 10K char limit (first 5K + last 5K)
- **Environment isolation**: Only `HOME`, `LANG`, `TERM` passed through; API keys excluded
- **No user approval**: Auto-executes, hooks for logging only

### What Pollux already has
- Nothing for shell execution
- But the SDK has a built-in `Bash` tool with its own security model

### What's needed
- **Agent config**: Add `Bash` to `allowedTools`
- **System prompt**: Describe shell capabilities and any constraints
- **UI**: Terminal-like output rendering (monospace, exit codes, stderr highlighting)
- **Security model**: This is the main work:
  - SDK's `Bash` tool runs commands directly — no built-in blocklist
  - Options: (a) rely on `permissionMode` to gate execution, (b) use `canUseTool` callback for custom approval, (c) accept auto-execution for single-user local app
  - Consider a settings toggle to enable/disable shell access
  - Consider `sandbox` option in SDK query config

### Security considerations
- Highest risk of the four features — arbitrary command execution
- Single-user local app mitigates this: the agent can't do more than the user
- Still want guardrails against accidental damage (`rm -rf /`, `shutdown`)
- SDK may have its own safeguards via permission mode — investigate at implementation time

---

## Feature 3: MCP Server Integration

### How nanobot does it
- `nanobot/agent/tools/mcp.py`: Custom MCP client with `MCPToolWrapper`
- Config in `~/.nanobot/config.json` under `tools.mcp_servers`
- Three transports: stdio (local process), SSE, streamable HTTP — auto-detected
- Tool naming: `mcp_<server>_<tool>` for namespacing
- Lifecycle: lazy connect on first message, health checks via `list_tools()`, cleanup via `AsyncExitStack`
- Also wraps MCP resources and prompts as callable tools
- Per-tool timeout (default 30s), tool allowlisting (`enabled_tools`)

### What Pollux already has
- Nothing for MCP
- But the SDK has native `mcpServers` option in `query()`:
  ```typescript
  mcpServers: {
    "server-name": { type: "stdio", command: "npx", args: [...] },
    "remote": { type: "http", url: "...", headers: {...} }
  }
  ```
- SDK handles transport, lifecycle, tool discovery, and namespacing internally

### What's needed
- **Config storage**: New DB table (`mcp_servers`) or JSON config file for server definitions
- **Settings UI**: Add/edit/remove MCP servers (name, type, command/url/args, enabled tools)
- **Agent config**: Pass `mcpServers` from config to `query()` options
- **SDK callbacks**: Handle `onElicitation` for MCP servers that request user input
- **UI**: MCP tool results rendered same as other tool results

### Security considerations
- Stdio MCP servers run local processes — same risk profile as shell execution
- HTTP MCP servers send data to external endpoints — user must explicitly configure
- Tool allowlisting (`enabled_tools` equivalent) controls blast radius
- Single-user local app: user is explicitly choosing which servers to connect

---

## Feature 4: Subagent Spawning

### How nanobot does it
- `nanobot/agent/subagent.py`: `SubagentManager` class
- `nanobot/agent/tools/spawn.py`: `SpawnTool` — main agent calls `spawn(task, label)`
- Each spawn creates an `asyncio.Task` for true parallelism
- Results flow back via message bus as system messages to the parent agent
- Session-based cancellation via `asyncio.Task.cancel()`
- Subagents get their own tool set (via `ToolRegistry`)

### What Pollux already has
- Nothing for subagents
- SDK supports `agents` option (AgentDefinition type) and built-in `Agent` tool
- SDK handles parallel execution, context passing, and result collection

### What's needed
- **Agent definitions**: Define what subagents can do (e.g., "researcher" with web tools, "coder" with filesystem + bash)
- **Agent config**: Pass `agents` definitions to `query()` options
- **Task tracking UI**: Show running subagents, their status, and results
- **Cancellation**: Wire abort controllers for individual subagents
- **Cost tracking**: Aggregate cost across parent + child agents
- **Settings**: Configure available agent types and their tool sets

### Security considerations
- Subagents inherit tool access — compound risk if shell + filesystem enabled
- Cost amplification: parallel subagents multiply API usage
- `maxBudgetUsd` on the parent query caps total spend
- Single-user local: acceptable, but budget controls important

---

## Dependencies Between Features

```
Filesystem ──→ Shell ──→ MCP
    │             │        │
    └─────────────┴────────┴──→ Subagents
```

- **Filesystem → Shell**: Filesystem proves the tool-result rendering pipeline (ToolUse data model, collapsible UI blocks). Shell reuses the same pipeline with terminal-specific rendering.
- **Shell → MCP**: Shell validates the security model (permission modes, approval flow). MCP extends it to external tools.
- **All → Subagents**: Subagents are most useful when they have tools to work with. Also the most complex feature — benefits from all lessons learned.

---

## Recommended Implementation Order

### 1. Filesystem Tools — Scope: M

**Why first:**
- Lowest risk (read-only operations initially)
- `dream.ts` already proves the SDK pattern works
- Forces the essential infrastructure: extended ToolUse type, tool-result rendering in MessageBubble
- Immediate user value: "read this file", "search my code", "what's in this directory"

**What it unlocks:** Tool data model + rendering pipeline reused by all subsequent features.

**Breakdown:**
- Extend `ToolUse` type with `input`/`output` fields
- Update SSE parsing to capture tool input/output from SDK stream
- Build collapsible tool-result components in MessageBubble
- Add `Read`, `Glob`, `Grep` to `allowedTools` (read-only phase)
- Add `Write`, `Edit` to `allowedTools` (write phase, behind settings toggle)
- Update system prompt with filesystem capability description

### 2. Shell Execution — Scope: M

**Why second:**
- Reuses the tool rendering pipeline from step 1
- Transforms Pollux from chat-only to a capable local agent
- Security model is the main new work, but simplified for single-user local

**What it unlocks:** Full local agent capability. Makes MCP and subagents meaningful.

**Breakdown:**
- Add `Bash` to `allowedTools` (behind settings toggle)
- Terminal-style output component (monospace, exit code, stderr)
- Settings toggle: enable/disable shell access
- Investigate SDK `sandbox` option for optional sandboxing
- Update system prompt with shell capability description

### 3. MCP Integration — Scope: M

**Why third:**
- SDK handles all the hard parts (transport, lifecycle, tool discovery)
- Pollux just needs config storage + settings UI + passthrough
- Opens Pollux to the entire MCP tool ecosystem

**What it unlocks:** External tool connectivity — databases, APIs, custom tools.

**Breakdown:**
- DB table or config file for MCP server definitions
- Settings UI panel: add/edit/remove servers
- Pass `mcpServers` config to `query()` call
- Handle `onElicitation` callback for MCP user input
- MCP tool results rendered via existing tool pipeline

### 4. Subagent Spawning — Scope: L

**Why last:**
- Most complex feature, least immediate user value for single-user
- Benefits from having filesystem + shell + MCP tools available
- Needs task management UI that doesn't exist yet

**What it unlocks:** Parallel work delegation — "research X while editing Y"

**Breakdown:**
- Define agent types with tool presets
- Pass `agents` to `query()` options
- Task progress UI (running/completed/failed states)
- Cancellation via abort controllers
- Budget controls for aggregate cost
- Settings: configure agent types and their capabilities
