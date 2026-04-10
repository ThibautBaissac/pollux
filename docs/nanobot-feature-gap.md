# Feature Gap: Nanobot vs Pollux

Comparison of user-facing features present in [nanobot](../../../ThibautBaissac/nanobot) but missing from Pollux.

**Source:** `/Users/thibautbaissac/code/ThibautBaissac/nanobot`
**Date:** 2026-04-10
**Excludes:** Messaging platform integrations (WhatsApp, Telegram, Slack, Discord, etc.)

---

## Memory & Context

| Feature | What it does | User Impact | Effort |
|---------|-------------|-------------|--------|
| **Memory version history & rollback** | UI to browse git-committed memory snapshots and restore a previous version (`/dream-log`, `/dream-restore`) | **Med** — safety net when Dream overwrites something important; currently requires CLI git | **M** — git log/diff/checkout plumbing exists in `git-memory.ts`; needs a settings UI panel + API route |

## Agent Capabilities

| Feature | What it does | User Impact | Effort |
|---------|-------------|-------------|--------|
| **Code / shell execution tool** | Agent can run shell commands (with timeout, blocked patterns, output truncation) to answer questions or automate tasks | **High** — transforms Pollux from a chat-only assistant to a capable local agent | **L** — security model needed (sandboxing, command blocklist, output limits); SDK tool registration |
| **Filesystem tools** | Agent can read, write, edit, and list local files on behalf of the user | **High** — enables "edit my config", "read this log", "summarize this file" workflows | **L** — needs path restriction, permission model, and careful security boundaries |
| **Subagent spawning** | Main agent can spin up focused sub-agents for parallel work, each reporting back to the parent | **Low** — power-user feature; most solo-user queries are single-threaded | **L** — requires task tracking, cancellation, and parallel SDK session management |
| **MCP server integration** | Connect external Model Context Protocol tool servers (stdio or HTTP); tools auto-discovered and callable by the agent | **Med** — opens Pollux to any MCP-compatible tool ecosystem (databases, APIs, custom tools) | **M** — SDK supports MCP natively; needs config UI + server lifecycle management |

## Automation

| Feature | What it does | User Impact | Effort |
|---------|-------------|-------------|--------|
| **Scheduled reminders (cron)** | User says "remind me to X at 3pm every Friday" — agent schedules it, sends a message when due | **High** — primary daily-assistant use case; Pollux currently has no proactive notifications | **M** — needs a cron store (SQLite table), background scheduler process, and notification delivery via the web app |
| **Heartbeat background tasks** | Periodic agent runs (e.g. every 30 min) that read a task file and execute recurring work autonomously | **Med** — enables "check my deploys", "summarize RSS feeds" without user prompting | **M** — similar to Dream's scheduler but generalized; needs a `HEARTBEAT.md` equivalent + runner |

## Configuration

| Feature | What it does | User Impact | Effort |
|---------|-------------|-------------|--------|
| **Reasoning effort control** | Toggle between low/medium/high/adaptive thinking depth per conversation or globally | **Med** — quick questions get fast answers; complex tasks get deep reasoning | **S** — `agent.ts` already uses adaptive; expose a dropdown in settings or per-message toggle |
| **Temperature / max tokens config** | User tunes response creativity and length limits | **Low** — most users never touch these; advanced-only knob | **S** — add fields to settings, pass through to SDK |

## UI / UX

| Feature | What it does | User Impact | Effort |
|---------|-------------|-------------|--------|
| **In-chat slash commands** | `/new`, `/stop`, `/status`, `/dream` — quick actions typed directly in the message input | **Med** — faster than navigating menus; power-user productivity boost | **S** — intercept input starting with `/` in `ChatInput`, dispatch client-side or to API |
| **Token / cost usage display** | Show tokens consumed and estimated cost per message or session, viewable via `/status` | **Med** — essential for budget awareness on a pay-per-token API | **S** — SDK returns usage metadata; store in messages table, render in UI |

## Extensibility

| Feature | What it does | User Impact | Effort |
|---------|-------------|-------------|--------|
| **Skill / plugin system** | Install, create, and share agent skills (bundles of prompts + tools + scripts) from a marketplace | **Low** — powerful but niche for a single-user local app; real value comes with a community | **L** — needs skill format spec, discovery/install UI, runtime loading, and a registry |

---

## Quick-Win Candidates (High Impact + Small Effort)

1. **Bot personality customization** — add `data/memory/soul.md`, inject in system prompt, expose in settings memory editor
2. **In-chat slash commands** — intercept `/` prefix in `ChatInput`, dispatch to handlers
3. **Conversation search** — SQLite LIKE/FTS query + search bar in sidebar
4. **Token usage display** — capture SDK usage metadata, render per-message or in header
5. **Reasoning effort control** — settings dropdown, pass to SDK config

## Transformative but Expensive

1. **Code/shell execution** + **Filesystem tools** — turns Pollux into a local agent; requires sandboxing & security model
2. **Scheduled reminders** — the core "assistant" feature; needs background scheduler + push notifications
3. **MCP integration** — unlocks external tool ecosystem; SDK has native support
