# Skills — Procedural Memory for Pollux

Status: **Spec** (not yet implemented)
Owner: TBD
Last updated: 2026-04-13
Ref: /Users/thibautbaissac/Downloads/hermes-agent

## 1. Summary

Add **skills** as a first-class concept alongside the existing memory system. A skill is a named, procedural recipe — *how to do a specific kind of task the way the user likes it done*. Examples: a weekly-review template, a PR-description style, a research-summary format, a recurring shell pattern.

Skills are stored as markdown files on disk, indexed into the system prompt by name + description only, and loaded in full on demand via a built-in MCP tool. The agent discovers them, picks them, reads them, follows them, and edits them when they're wrong.

Inspired by the skills system in [Nous Research's Hermes agent](https://github.com/NousResearch/hermes-agent), adapted heavily for Pollux's single-user, local-first, one-model architecture.

## 2. Why

Pollux already has a memory system: `soul.md` (personality), `profile.md` (user facts), `knowledge.md` (persistent facts). These are **declarative** — "X is true" — and all three files are concatenated into the system prompt on every turn.

That model breaks down for procedural knowledge:

- **Token cost**: Every recipe stuffed into `knowledge.md` is paid on every turn, even when irrelevant.
- **Discoverability**: A fact buried in `knowledge.md` is only found if the model happens to read it carefully. A named skill in an index is explicitly surfaced as a capability the agent should scan before replying.
- **Shape**: Recipes want their own structure (when-to-use, steps, format rules, examples). Cramming them into a flat facts file fights the format.

Skills solve all three: index is cheap (name + ≤280-char description), full content is loaded lazily by the agent via a tool call, and each skill owns its own markdown structure.

## 3. Non-goals (v1)

Explicit cut list, with reasoning:

| Cut | Reason |
|---|---|
| Skill hub / marketplace / sharing | Local-first, single-user. Git handles sync. |
| Security scanning of skill content | Single-user, already-trusted machine. |
| Platform / OS filtering | One known environment. |
| Conditional activation (`requires_toolsets`, `fallback_for_toolsets`) | All tools always available. |
| Per-skill config vars in `config.yaml` | Skills can just ask the user in chat. |
| Version tracking, update notifications | Git log is the history. |
| `/skill-name` slash commands as invocation triggers | The whole point is the agent picks skills from the index. A `/skill-name` command reduces to "send a message mentioning the skill", which already works. |
| DB table for skills | Filesystem is the source of truth, same as memory files. |
| Execution log entries for skill use | Skills are inline tool calls, not scheduled runs. Logging every call would drown the notification panel. |

Rationale summary: Hermes is a framework serving many users and deployment shapes; Pollux is one person's assistant. Roughly 80% of Hermes's skill-system complexity is multi-tenant / sharing infrastructure that doesn't apply.

## 4. Data model

### 4.1 File format

One directory per skill. Entry point is always `SKILL.md`. YAML frontmatter + markdown body.

```markdown
---
name: weekly-review
description: Produce my weekly review in the format I prefer — three sections (shipped / blocked / next), terse bullets, no adjectives.
tags: [productivity, writing]
---

## When to use
When I ask for a weekly review, a weekly summary, or say "wrap up the week".

## Steps
1. Read my git log across all repos under `~/code` for the past 7 days.
2. Group commits by repo, then by theme (feature / fix / refactor).
3. Produce three sections: **Shipped**, **Blocked**, **Next**.

## Format rules
- Bullets only. No prose paragraphs.
- Past tense for Shipped, present for Blocked, imperative for Next.
- Max 5 bullets per section.
```

### 4.2 Frontmatter schema

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | string | yes | kebab-case, `^[a-z][a-z0-9-]{1,47}$`, must match directory name |
| `description` | string | yes | 1–280 chars. This is what's injected into the system prompt. Treat it like ad copy. |
| `tags` | string[] | no | Free-form. Used for UI filtering only. |

Reject unknown fields at parse time, but with a warning (log), not an error — forward-compatibility.

### 4.3 Storage layout

```
data/
  skills/
    weekly-review/
      SKILL.md
    pr-description/
      SKILL.md
      examples/
        good-1.md
        good-2.md
    research-summary/
      SKILL.md
```

- Path: `data/skills/<slug>/SKILL.md`
- Slug = directory name = frontmatter `name`. Validated equal on load; mismatch = skill is ignored with a warning.
- Supporting files (`examples/`, `references/`, `templates/`, whatever) can live anywhere under the skill dir. The agent reads them via the existing `Read` tool once it has viewed the skill — no special tooling required.

### 4.4 Why no database table

YAGNI. No queries beyond "list all" and "read one by name". Filesystem reads are cheap and cached per-request. Keeping skills as plain files means:

- `git diff` shows meaningful changes.
- Users can edit in their own editor if they want.
- No migration needed for schema tweaks.
- Mirrors the existing memory-file pattern (`data/memory/*.md`).

## 5. System-prompt injection

### 5.1 What gets injected

Extend `buildSystemPrompt()` in `src/lib/agent.ts` (currently around line 51). After the memory block and before the tools block, insert a Skills section:

```
## Skills
You have procedural skills available. Each is a named how-to for a specific kind of task.
Before replying, scan this list. If a skill matches or is partially relevant to the
request, call the `skill` tool with action='view' to load its full instructions,
then follow them. If a skill is missing a step or is wrong, fix it with
action='edit' — this is how skills improve.

- weekly-review — Produce my weekly review in the format I prefer...
- pr-description — Write PR descriptions the way I like them...
- research-summary — Summarize a research session into my notes format...
```

When zero skills exist, omit the section entirely (no empty heading).

### 5.2 Index generation

New module `src/lib/skills.ts` exposing:

```typescript
type SkillIndexEntry = { name: string; description: string; tags: string[] };
type Skill = { name: string; description: string; tags: string[]; body: string };

readSkillIndex(): SkillIndexEntry[]            // sorted by name
readSkill(name: string): Skill | null          // returns null if not found or invalid
writeSkill(input: {
  name: string;
  description: string;
  body: string;
  tags?: string[];
}): void                                       // create OR overwrite; validates name collision on create
deleteSkill(name: string): void
listSupportingFiles(name: string): string[]    // relative paths under data/skills/<name>/, excluding SKILL.md
```

Implementation notes:
- Walk `data/skills/` once, one `stat` + `readFile` per `SKILL.md`, parse frontmatter with `gray-matter` (already fits Pollux's dependency taste — small, zero-dep otherwise) or a minimal hand-rolled parser if we want to avoid the dep.
- No caching in v1. If profiling shows it matters later, cache the index with an mtime-based invalidation — but the memory files are read fresh every turn too and nobody has complained, so skip.
- Skip directories whose `SKILL.md` fails validation; surface the error through a separate `readSkillDiagnostics()` that the settings UI can display.

### 5.3 Wiring into chat

In `src/lib/chat.ts` (around `createChatStream`, currently ~line 120), alongside the existing `readMemory()` call:

```typescript
const memoryContent = readMemory();
const skillIndex = readSkillIndex();
```

Pass `skillIndex` into `buildSystemPrompt(memoryContent, skillIndex, cwd)`.

### 5.4 Prompt budget

Each skill contributes roughly `"- <name> — <description>\n"` to the system prompt. At 280-char descriptions + ~20 chars overhead, a 30-skill index is ~9 KB of prompt. Comfortable.

**Soft limit: 30 skills.** Above that, show a warning in the Skills UI: "Large skill indexes inflate every prompt. Consider pruning or merging skills." No hard block.

## 6. MCP tool: `pollux-skills`

Mirror `src/lib/reminder-tool.ts` exactly. One server, one tool, discriminated-union input.

### 6.1 New file: `src/lib/skill-tool.ts`

```typescript
const SKILL_MCP_SERVER_NAME = "pollux-skills";
const SKILL_MCP_TOOL_NAME = "skill";

const skillTool = tool({
  name: SKILL_MCP_TOOL_NAME,
  description: "Manage procedural skills. Actions: list, view, create, edit, delete.",
  inputSchema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list") }),
    z.object({ action: z.literal("view"), name: z.string() }),
    z.object({
      action: z.literal("create"),
      name: z.string(),
      description: z.string().min(1).max(280),
      body: z.string(),
      tags: z.array(z.string()).optional(),
    }),
    z.object({
      action: z.literal("edit"),
      name: z.string(),
      description: z.string().min(1).max(280).optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    z.object({ action: z.literal("delete"), name: z.string() }),
  ]),
  handler: async (input) => { /* dispatch on input.action */ },
});

export const skillMcpServer = createSdkMcpServer({
  name: SKILL_MCP_SERVER_NAME,
  tools: [skillTool],
});
```

### 6.2 Return shapes

- `list` → `{ skills: Array<{ name, description, tags }> }` (same as `readSkillIndex()`)
- `view` → `{ name, description, tags, body, supporting_files: string[] }`
- `create` / `edit` / `delete` → `{ ok: true }` on success
- Errors: throw with a clear message; the SDK surfaces it as the tool result.

### 6.3 Validation rules (enforced in the tool handler, not just the UI)

- `name` slug regex on create.
- `description` length on create + edit.
- `create` fails if skill already exists.
- `edit` / `view` / `delete` fail with a clear message if skill doesn't exist.
- `delete` is immediate — no trash. (The user has git for regret.)

### 6.4 Agent registration

In `src/lib/agent.ts`:

```typescript
const SKILL_ALLOWED_TOOL = `mcp__${SKILL_MCP_SERVER_NAME}__${SKILL_MCP_TOOL_NAME}`;

// ...

const mcpServers = {
  [REMINDER_MCP_SERVER_NAME]: reminderMcpServer,
  [SKILL_MCP_SERVER_NAME]: skillMcpServer,
  ...userMcpServers,
};

allowedTools: [...ALLOWED_TOOLS, REMINDER_ALLOWED_TOOL, SKILL_ALLOWED_TOOL],
```

## 7. REST API

Thin wrappers over `src/lib/skills.ts`, mirroring the existing `/api/memory` style.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/skills` | — | `{ skills: SkillIndexEntry[] }` |
| `POST` | `/api/skills` | `{ name, description, body, tags? }` | `{ ok: true }` (409 on name collision) |
| `GET` | `/api/skills/[name]` | — | `{ name, description, tags, body, supporting_files }` (404 if missing) |
| `PUT` | `/api/skills/[name]` | `{ description?, body?, tags? }` | `{ ok: true }` |
| `DELETE` | `/api/skills/[name]` | — | `{ ok: true }` |

All routes:
- Guarded via `requireAuth()`.
- Rate-limited under the same bucket as `/api/memory` (define in `src/lib/rate-limit-config.ts`).
- Input validated with the same Zod schemas used in the MCP tool (share the schemas via `src/lib/skills.ts`).
- 400 on invalid input; 404 on missing skill; 409 on create collision.

## 8. Slash command

Add `skills` to `src/lib/slash-commands.ts`:

```typescript
export type SlashCommandName = "new" | "stop" | "status" | "dream" | "skills";

export const COMMAND_DEFS: readonly SlashCommandDef[] = [
  // ...existing...
  { name: "skills", description: "Open the skills manager" },
];
```

Client handling in `ChatInput`: `/skills` navigates to `/settings?section=skills`. No message is sent to the agent — same pattern as `/dream` triggering a dream run without hitting the chat API.

Explicitly **not** adding `/skill-name` commands. Invocation is the agent's job via the prompt index.

## 9. Settings UI

### 9.1 Structure

Add a **Skills** entry to the `Integrations` group in `src/components/settings/SettingsPageClient.tsx` (currently around line 32):

```typescript
{
  label: "Integrations",
  sections: [
    { key: "mcp-servers", label: "MCP Servers", description: "..." },
    { key: "reminders", label: "Reminders", description: "..." },
    { key: "skills", label: "Skills",
      description: "Procedural recipes the agent can discover and use." },
  ],
},
```

### 9.2 New component: `SkillsManager.tsx`

Two-pane layout inside the existing settings section container:

- **Left pane** (fixed-width list):
  - `+ New skill` button at the top.
  - Scrollable list of skills. Each row: skill name (bold), description (muted, 2-line clamp), tag chips.
  - Selected row highlighted.
  - Empty state: "No skills yet. Create one from a recipe you keep repeating."

- **Right pane** (editor):
  - Form fields: `name` (required on create, disabled on edit — rename = delete + create), `description` (textarea with char counter, hard cap 280), `tags` (comma-split text input).
  - `body` editor: monospace `<textarea>`, min-height 400px. No preview in v1. No syntax highlighting in v1.
  - Buttons: `Save` (disabled when pristine), `Delete` (with JS confirm dialog), `Cancel` (discards unsaved edits).
  - "Supporting files" footer: lists files under the skill dir other than `SKILL.md`, read-only. Managed outside Pollux (finder / editor).

### 9.3 Styling

Reuse the existing memory-editor look. Dark theme, rounded corners, accent color for the save button, destructive red for delete. No emojis.

### 9.4 Query param

Respect `?section=skills` so `/skills` slash command can deep-link. Existing pattern — settings page already reads `searchParams`.

## 10. Seed content

Ship one example skill committed to the repo so the feature isn't empty on first run.

`data/skills/weekly-review/SKILL.md` — content as shown in §4.1. Use a generic-enough phrasing that it's useful out of the box and self-documents the format. Mark it clearly as editable/deletable in the description.

## 11. Tests

New file `tests/skills.test.ts`. Follow the temp-dir pattern used in `tests/memory.test.ts`:

- `readSkillIndex()` returns sorted entries.
- `readSkillIndex()` skips invalid frontmatter with a diagnostic.
- `readSkill()` returns `null` for missing skill.
- `writeSkill()` creates a new skill with correct path + frontmatter.
- `writeSkill()` on existing name overwrites (from the `edit` flow) — but the MCP/API layer guards against unintended creates.
- `deleteSkill()` removes the directory entirely (including supporting files) — confirm recursive delete is intentional.
- Validation: name regex, description length, name = dirname invariant.
- MCP tool dispatch: each action round-trips through the handler.

Add to coverage scope in `vitest.config.ts`: `src/lib/skills.ts`, `src/lib/skill-tool.ts`.

## 12. Documentation updates

After landing:

- Add a **Skills system** section to the root `CLAUDE.md`, mirroring the length of the existing **Memory system** section. Explain: what skills are, where they live, how they're injected, how the agent uses the `pollux-skills` MCP server.
- Add one line to the **Agent capabilities** section: "Skills are exposed via a built-in `pollux-skills` MCP server."
- Update the README (if applicable) user-facing feature list.

## 13. Dream integration (deferred to v1.5)

The Dream system already acts as an agent that maintains memory. It's the right place to auto-propose skills from repeated patterns, but this is **out of scope for v1**. Reasoning: we need to dogfood manual skills first before deciding whether auto-proposals are worth the complexity and prompt cost.

When we revisit, the cheapest approach is:

- Extend the Phase 2a analysis prompt with a fourth directive: `[SKILL-PROPOSE]`, emitted when the history shows the user asking for the same kind of output 3+ times with a consistent shape.
- Instead of having Phase 2b write skill files directly (which would require loosening the file allowlist), append proposals to `data/skills/.proposals.md`.
- In the Skills UI, show a "Proposed skills" section above the list with one-click Accept / Dismiss per proposal.

This keeps Dream's write surface conservative and puts skill creation behind explicit user approval, which matches the rest of Pollux's trust model.

Revisit date: **after ~4 weeks of manual skill use in v1**, not sooner.

## 14. Open questions to resolve before coding

1. **Frontmatter parser — add `gray-matter` or hand-roll?** Hand-rolled is ~40 lines and zero-dep. `gray-matter` is battle-tested but adds a dependency. Lean hand-rolled unless we hit edge cases.
2. **Should `edit` with an unknown `name` upsert, or fail?** Spec above says fail. Confirm before implementing — the tool being forgiving here could mask typos.
3. **Should `delete` cascade supporting files?** Spec above says yes (recursive). Confirm — a user who manually dropped a `notes.md` into the skill dir might be surprised.
4. **Description length cap — is 280 right?** Tuned from Twitter-intuition, not measurement. After 30-skill dogfooding, reassess. For now: soft warning above 200, hard block above 280.

## 15. Implementation plan (PR breakdown)

1. **PR 1 — Core.** `src/lib/skills.ts`, `src/lib/skill-tool.ts`, wiring in `src/lib/agent.ts`, system-prompt extension in `buildSystemPrompt()`, one seeded skill, unit tests. No UI, no API. Agent can create/view/edit/delete via tool calls.
2. **PR 2 — API.** `src/app/api/skills/` routes + auth + rate limit. Keeps the feature usable programmatically before the UI lands.
3. **PR 3 — UI.** `SkillsManager` component + settings wiring + `/skills` slash command + CLAUDE.md updates.
4. **Dogfood for ~4 weeks** before touching Dream.
5. **PR 4 (v1.5, gated).** Dream proposals to `.proposals.md` + UI accept/dismiss.

Each PR is independently landable and leaves the system in a consistent state.
