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
| `description` | string | yes | 1–200 chars (soft warn above 150). This is what's injected into the system prompt. Treat it like ad copy. |
| `tags` | string[] | no | Free-form. Used for UI filtering only. |

Unknown fields are **ignored silently** (forward-compatibility). Missing required fields invalidate the skill and surface via `readSkillDiagnostics()` (§5.2). No middle ground — either a skill loads or it's in diagnostics; no half-loaded skills.

**Body size cap: 32 KB.** A single skill `view` returning hundreds of KB would blow the turn budget even if the index stays small. Enforced on create/update (write rejects) and on read (oversized body surfaces as a diagnostic, not loaded).

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

- Path: `data/skills/<slug>/SKILL.md`, resolved against `process.cwd()` (the Pollux app root, same pattern as `MEMORY_DIR` in `src/lib/memory.ts:10`). This is **not** `getCwd()` from `src/lib/cwd-store.ts` — that one is the agent's working directory for Read/Glob/Bash, often a different repo.
- Slug = directory name = frontmatter `name`. Validated equal on load; mismatch = skill is rejected with a diagnostic.
- Supporting files (`examples/`, `references/`, `templates/`, whatever) can live under the skill dir. Because `data/skills/` is under the Pollux app root (not the agent's cwd), the agent's filesystem tools cannot reach them by relative path. They are exposed only through the `pollux-skills` MCP tool:
  - `view` returns `supporting_files: { path, size_bytes }[]` (metadata only, sorted, capped at 100 entries).
  - `view_file` action loads a specific file's content by `{ name, path }`, capped at 32 KB per call.
  - Symlinks are rejected at both list and read time — skill dirs must be self-contained. Reason: a symlink that escapes the skill dir turns "view supporting file" into arbitrary filesystem read.

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
then follow them. If a skill has supporting examples or templates, fetch them with
action='view_file'. If a skill is missing a step or is wrong, fix it with
action='update' — this is how skills improve.

- weekly-review — Produce my weekly review in the format I prefer...
- pr-description — Write PR descriptions the way I like them...
- research-summary — Summarize a research session into my notes format...
```

When zero skills exist, omit the section entirely (no empty heading).

### 5.2 Index generation

New module `src/lib/skills.ts` exposing:

```typescript
type SkillIndexEntry = { name: string; description: string; tags: string[] };
type Skill = {
  name: string;
  description: string;
  tags: string[];
  body: string;
  supportingFiles: { path: string; sizeBytes: number }[];
};
type SkillDiagnostic = { dir: string; reason: string };
type CreateInput = {
  name: string;
  description: string;
  body: string;
  tags?: string[];
};
type UpdatePatch = {
  description?: string;
  body?: string;
  tags?: string[];
};

readSkillIndex(): SkillIndexEntry[]            // sorted by name; excludes invalid skills
readSkill(name: string): Skill | null          // null if not found or invalid
readSkillDiagnostics(): SkillDiagnostic[]      // invalid skill dirs with reasons
readSupportingFile(name: string, relPath: string): string  // throws on symlink, missing, oversize
createSkill(input: CreateInput): void          // throws if name exists
updateSkill(name: string, patch: UpdatePatch): void  // throws if missing; at least one patch field required
deleteSkill(name: string): { deleted: string[] }  // recursive; returns paths removed relative to skill dir
```

Split rationale: `create` and `update` have incompatible preconditions (create fails on collision, update fails on missing). A single `writeSkill` that is "create or overwrite" cannot express that without mode flags, and mode flags defeat the point. Keep the two verbs separate in the module, in the MCP tool, and in the REST API.

Implementation notes:
- Walk `data/skills/` once, one `stat` + `readFile` per `SKILL.md`. Parse frontmatter with `gray-matter`. Earlier draft said hand-rolled; Codex rightly flagged that regex-YAML is the worst of both worlds — either the header is real YAML (use `gray-matter`/`js-yaml`) or it's not YAML at all. Since the precedent and Hermes reference both use YAML frontmatter, commit to it properly.
- `readSkillDiagnostics()` is surfaced via `GET /api/skills/diagnostics` and rendered in the settings UI as a warning banner. Invisible invalid skills are a footgun.
- Symlink rejection: use `lstat` during the walk and on every supporting-file read. Refuse any entry whose type is symlink.
- Size caps enforced in the module (not just the UI / API): 32 KB per `body`, 32 KB per supporting file read, 100 supporting files per skill.
- No caching in v1. Memory files are read fresh every turn too and nobody has complained. Revisit with profiling if index generation shows up.
- Concurrency: the app is single-user, single-writer. Last-write-wins across UI / MCP / local editor is acceptable. No file locking. Call this out so future-us doesn't build optimistic concurrency by accident.

### 5.3 Wiring into the agent

Read the skill index **inside `startAgent()`** in `src/lib/agent.ts:108`, not in the chat route. Reason: chat and scheduled reminders both call `startAgent()`. If the index is threaded through chat only, scheduled-agent runs (`src/lib/scheduled-agent.ts:48`) will be skill-blind. The memory content is currently a param because the chat route reads it before persisting the user message, but skills have no such ordering requirement — they can be read at agent-start time.

```typescript
// src/lib/agent.ts — inside startAgent()
const cwd = getCwd();
const skillIndex = readSkillIndex();
const userMcpServers = getMcpServers();
// ...
systemPrompt: buildSystemPrompt(params.memoryContent, skillIndex, cwd),
```

`buildSystemPrompt()` signature becomes `(memoryContent: string, skillIndex: SkillIndexEntry[], cwd: string)`. No changes in `chat.ts` or `scheduled-agent.ts` — they keep calling `startAgent()` as today.

### 5.4 Prompt budget

Each skill contributes roughly `"- <name> — <description>\n"` to the system prompt. At 200-char descriptions + ~20 chars overhead, a 30-skill index is ~6.5 KB of prompt. Comfortable.

**Soft limit: 30 skills.** Above that, show a warning in the Skills UI: "Large skill indexes inflate every prompt. Consider pruning or merging skills." No hard block.

## 6. MCP tool: `pollux-skills`

Mirror `src/lib/reminder-tool.ts` exactly. One server, one tool, discriminated-union input.

### 6.1 New file: `src/lib/skill-tool.ts`

```typescript
const SKILL_MCP_SERVER_NAME = "pollux-skills";
const SKILL_MCP_TOOL_NAME = "skill";
const BODY_MAX = 32 * 1024;
const FILE_MAX = 32 * 1024;

const updatePatch = z.object({
  description: z.string().min(1).max(200).optional(),
  body: z.string().max(BODY_MAX).optional(),
  tags: z.array(z.string()).optional(),
}).refine(
  (p) => p.description !== undefined || p.body !== undefined || p.tags !== undefined,
  { message: "update requires at least one of description, body, tags" },
);

const skillTool = tool({
  name: SKILL_MCP_TOOL_NAME,
  description:
    "Manage procedural skills. Actions: list, view, view_file, create, update, delete.",
  inputSchema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list") }),
    z.object({ action: z.literal("view"), name: z.string() }),
    z.object({
      action: z.literal("view_file"),
      name: z.string(),
      path: z.string(),   // relative to skill dir, no "..", no absolute paths
    }),
    z.object({
      action: z.literal("create"),
      name: z.string(),
      description: z.string().min(1).max(200),
      body: z.string().max(BODY_MAX),
      tags: z.array(z.string()).optional(),
    }),
    z.object({
      action: z.literal("update"),
      name: z.string(),
      patch: updatePatch,
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

Renamed `edit` → `update` to match the split in `src/lib/skills.ts` (createSkill / updateSkill). The system-prompt instruction in §5.1 uses `action='update'` accordingly.

### 6.2 Return shapes

- `list` → `{ skills: Array<{ name, description, tags }> }` (same as `readSkillIndex()`)
- `view` → `{ name, description, tags, body, supporting_files: { path, size_bytes }[] }` — supporting-file contents are NOT inlined; use `view_file` to fetch one.
- `view_file` → `{ name, path, content }` — text only; binary / oversized files throw.
- `create` / `update` → `{ ok: true }` on success
- `delete` → `{ ok: true, deleted: string[] }` — paths removed relative to skill dir, always includes `SKILL.md` plus any supporting files. Lets the agent surface unexpected deletions back to the user.
- Errors: throw with a clear message; the SDK surfaces it as the tool result.

### 6.3 Validation rules (enforced in the tool handler, not just the UI)

- `name` slug regex on create.
- `description` length on create + update.
- `body` size ≤ 32 KB on create + update.
- `update` patch must include at least one of `description`, `body`, `tags` (refine in Zod).
- `create` fails if skill already exists.
- `update` / `view` / `view_file` / `delete` fail with a clear message if skill doesn't exist.
- `view_file` rejects symlinks, absolute paths, and paths containing `..`. Resolved path must stay inside the skill dir.
- `delete` is immediate — no trash. (The user has git for regret.) It **does** cascade supporting files; the returned `deleted` list makes the scope auditable. On partial failure (e.g., EPERM on one file), the handler throws with `{ deleted: [...successful paths], remaining: [...unremoved paths] }` embedded in the error message so the caller can see what's left on disk. The skill dir itself is removed only if it's empty at the end.

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
| `GET` | `/api/skills` | — | `{ skills: SkillIndexEntry[], diagnostics: SkillDiagnostic[] }` |
| `POST` | `/api/skills` | `{ name, description, body, tags? }` | `{ ok: true }` (409 on name collision) |
| `GET` | `/api/skills/[name]` | — | `{ name, description, tags, body, supporting_files }` (404 if missing) |
| `GET` | `/api/skills/[name]/files/[...path]` | — | raw text body (404 if missing; 403 on symlink / escape) |
| `PATCH` | `/api/skills/[name]` | `{ description?, body?, tags? }` — at least one required | `{ ok: true }` |
| `DELETE` | `/api/skills/[name]` | — | `{ ok: true, deleted: string[] }` |

Verb choice: `PATCH` (not `PUT`) because the update is a partial patch. Matches existing conventions where the resource representation is only partially mutable.

All routes:
- `GET` routes guarded via `requireAuth()`.
- **Mutating routes** (`POST`, `PATCH`, `DELETE`) guarded via `requireAuth()` **and** `requireTrustedRequest()` (see `src/lib/request-guards.ts:8`). Matches the memory `PUT` route. Without the trusted-request guard, any authenticated browser session is CSRFable from an arbitrary origin.
- Rate-limited: add a `skills` bucket to `src/lib/rate-limit-config.ts` (earlier draft assumed a `/api/memory` bucket that doesn't exist — memory isn't rate-limited today). Suggested: `{ key: "skills:mutate", limit: 60, windowMs: FIVE_MINUTES }` for `POST`/`PATCH`/`DELETE`; reads uncapped.
- Input validated with the same Zod schemas used in the MCP tool (share via `src/lib/skills.ts`).
- 400 on invalid input; 403 on untrusted origin or symlink / path-escape; 404 on missing skill; 409 on create collision; 413 on body-size overflow.

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
  - Form fields: `name` (required on create, disabled on edit — rename = delete + create), `description` (textarea with char counter, soft warn at 150, hard cap 200), `tags` (comma-split text input).
  - `body` editor: monospace `<textarea>`, min-height 400px. No preview in v1. No syntax highlighting in v1.
  - Buttons: `Save` (disabled when pristine), `Delete` (with JS confirm dialog), `Cancel` (discards unsaved edits).
  - "Supporting files" footer: lists files under the skill dir other than `SKILL.md`, read-only. Managed outside Pollux (finder / editor).

### 9.3 Styling

Reuse the existing memory-editor look. Dark theme, rounded corners, accent color for the save button, destructive red for delete. No emojis.

### 9.4 Query param

Respect `?section=skills` so `/skills` slash command can deep-link. **Earlier draft was wrong** — `SettingsPageClient.tsx:103` initializes `activeSection` from `useState("memory")` and ignores `searchParams`. Add this as part of PR 3:

```typescript
// SettingsPageClient props gain an initialSection
export function SettingsPageClient({ initialEmail, initialSection }: {
  initialEmail: string;
  initialSection?: Section;
}) {
  const [activeSection, setActiveSection] = useState<Section>(initialSection ?? "memory");
  // ...
}

// src/app/settings/page.tsx reads searchParams (server component) and forwards.
```

This change is small but is a prerequisite for the slash-command deep-link, not pre-existing infrastructure.

## 10. Seed content

Ship one example skill committed to the repo so the feature isn't empty on first run.

`data/skills/weekly-review/SKILL.md` — content as shown in §4.1. Use a generic-enough phrasing that it's useful out of the box and self-documents the format. Mark it clearly as editable/deletable in the description.

## 11. Tests

New file `tests/skills.test.ts`. Follow the temp-dir pattern used in `tests/memory.test.ts`:

Module-level (`src/lib/skills.ts`):
- `readSkillIndex()` returns entries sorted by `name`.
- `readSkillIndex()` excludes invalid skills; `readSkillDiagnostics()` reports them with reasons (bad frontmatter, name ≠ dirname, body oversize, symlinked `SKILL.md`).
- `readSkill()` returns `null` for missing skill.
- `readSkill()` returns supporting files as metadata only, size-sorted, capped at 100 entries; symlinks omitted.
- `readSupportingFile()` rejects: missing, oversize (>32 KB), symlink, absolute path, `..` traversal.
- `createSkill()` writes `SKILL.md` with gray-matter frontmatter + body; throws on existing name; enforces name regex, description length, body size cap.
- `updateSkill()` throws on missing skill; rejects empty patch; preserves frontmatter fields not in patch; enforces the same size/length caps.
- `deleteSkill()` removes the directory recursively and returns the `deleted` path list (including supporting files).
- `deleteSkill()` partial-failure path: if one file can't be removed, the error message embeds `{ deleted, remaining }` and the skill dir survives with the remaining files.

MCP tool (`src/lib/skill-tool.ts`):
- Each action dispatches correctly (list, view, view_file, create, update, delete).
- `view_file` rejects symlink / absolute / `..` path with a clear error.
- `update` with `{}` patch rejected by Zod `refine`.

API (`src/app/api/skills/`):
- `GET /api/skills` returns index + diagnostics.
- `POST` / `PATCH` / `DELETE` reject missing / bad `sec-fetch-site` / mismatched `origin` (403) via `requireTrustedRequest()`.
- `POST` hits the `skills:mutate` rate-limit bucket.
- `GET /api/skills/[name]/files/[...path]` rejects symlink / escape (403).
- `POST` returns 409 on name collision; `PATCH`/`DELETE` return 404 on unknown skill.

Add to coverage scope in `vitest.config.ts`: `src/lib/skills.ts`, `src/lib/skill-tool.ts`, `src/app/api/skills/`.

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

## 14. Resolved design decisions

1. **Frontmatter parser: `gray-matter`.** Earlier draft said hand-roll; reversed after Codex review. Half-YAML via regex is the worst of both worlds — it looks like YAML so users will try to use YAML features, then silently break. Either commit to real YAML or invent a non-YAML header. Since the precedent and Hermes reference both use YAML frontmatter, use `gray-matter` (which pulls in `js-yaml`) and accept the one-dep cost.
2. **`update` with an unknown `name`: fail.** Upsert would silently mask typos — the agent thinks it updated `weekly-review` but actually created `weekly-reveiw`. Failure costs one extra tool call; silent upsert costs a drifting duplicate the user never notices. Keep `create` and `update` distinct and unforgiving, matching the `reminder-tool.ts` pattern.
3. **`delete` cascades supporting files.** A skill directory is a unit: `SKILL.md` + `examples/` + `templates/` are co-authored. Orphaned files are the worse failure mode (stale references, confusing `git status`). The `delete` tool result returns the full list of removed paths (§6.2) so the agent can flag unexpected deletions to the user. On partial failure, the error embeds what was deleted vs. what remains (§6.3). Git covers regret.
4. **Description length cap: 200 hard, 150 soft-warn.** Tuned against prompt budget, not Twitter. 30 skills × 200 chars ≈ 6.5 KB — comfortable, and the ceiling forces descriptions to be scannable (the whole point of the index). Descriptions that want 280 chars are usually doing the skill body's job.
5. **Agent keeps write access in v1 (`create` / `update` / `delete`), despite self-modification risk.** Codex flagged this as the biggest risk: one bad tool call silently reshapes later turns. Read-only v1 would eliminate it. Kept anyway because §1's thesis — "the agent discovers them, picks them, reads them, follows them, **and edits them when they're wrong**" — is the whole feature; a read-only v1 is a different, smaller feature whose value is unclear until we've seen the agent try to self-improve. Mitigations: `git-memory.ts`-style auto-commit of skill-dir changes (defer, but lean toward it); the index on every turn is an audit surface; every mutation surfaces in the conversation as a tool call. Revisit after 4 weeks of dogfooding — if skills drift badly, downgrade MCP to `list` + `view` + `view_file` only.
6. **Body size cap: 32 KB.** Arbitrary-ish, but covers any realistic recipe and prevents a single `view` from blowing the turn budget. Symmetric cap on supporting files. Raise to 64 KB if a legitimate skill hits it; don't raise preemptively.
7. **Unknown frontmatter fields: silently ignored.** Codex rightly flagged "reject with warning" as meaningless. Forward-compat means ignoring fields; validation means erroring on them. Pick one — went with ignore so unknown fields don't break old skills when we add new ones.

## 15. Implementation plan (PR breakdown)

1. **PR 1 — Core.** `src/lib/skills.ts` (with gray-matter, size caps, symlink rejection, diagnostics), `src/lib/skill-tool.ts`, wiring into `startAgent()` in `src/lib/agent.ts`, system-prompt extension in `buildSystemPrompt()`, one seeded skill, unit tests. No UI, no API. Agent can list/view/view_file/create/update/delete via tool calls.
2. **PR 2 — API + hardening.** `src/app/api/skills/` routes (`requireTrustedRequest()` on mutations, new `skills:mutate` rate-limit bucket), `GET /api/skills/diagnostics` (or fold into `GET /api/skills` response). Supporting-file read route. Route tests covering 403 (origin / symlink / escape), 404, 409, 413.
3. **PR 3 — UI + slash command.** `SkillsManager` component, `SettingsPageClient` change to accept `initialSection` and read `?section=` on the server, `/skills` slash command, diagnostics banner in the Skills section, CLAUDE.md updates.
4. **Dogfood for ~4 weeks.** Watch for: drift from bad agent `update` calls (downgrade to read-only if bad), skill-count inflation, unused skills. Decide before Dream integration whether to auto-commit skill changes via `git-memory.ts`.
5. **PR 4 (v1.5, gated).** Dream proposals to `.proposals.md` + UI accept/dismiss. Possibly: auto-commit skill changes; possibly: MCP read-only downgrade if drift was a problem.

Each PR is independently landable and leaves the system in a consistent state.
