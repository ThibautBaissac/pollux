import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import {
  MEMORY_DIR,
  appendHistory,
  readMemoryFile,
  readHistorySince,
  getLastDreamCursor,
  setLastDreamCursor,
  compactHistory,
  type HistoryEntry,
} from "./memory";
import { gitCommitMemory } from "./git-memory";
import { db } from "./db";
import { conversations, messages as messagesTable } from "./db/schema";
import { eq, gt } from "drizzle-orm";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { dream as cfg } from "./dream-config";

const LAST_RUN_PATH = join(MEMORY_DIR, ".last_dream_run");
const LAST_PHASE2_PATH = join(MEMORY_DIR, ".last_dream_phase2");

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

function readTimestamp(path: string): Date {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date(0) : d;
  } catch {
    return new Date(0);
  }
}

function writeTimestamp(path: string, date: Date): void {
  writeFileSync(path, date.toISOString(), "utf-8");
}

// ---------------------------------------------------------------------------
// Phase 1 — Summarize recent conversations
// ---------------------------------------------------------------------------

const SUMMARIZER_PROMPT = `Extract key facts from this conversation. Only output items matching these categories, skip everything else:
- User facts: personal info, preferences, stated opinions, habits
- Decisions: choices made, conclusions reached
- Solutions: working approaches discovered, especially non-obvious methods
- Events: plans, deadlines, notable occurrences

Priority: user corrections and preferences > solutions > decisions > events.
Skip: anything trivially derivable from the conversation itself.
Output as concise bullet points, one fact per line. No preamble.
If nothing noteworthy happened, output exactly: (nothing)`;

async function phase1Summarize(): Promise<number> {
  const lastRun = readTimestamp(LAST_RUN_PATH);
  const now = new Date();

  const recentConvs = db
    .select()
    .from(conversations)
    .where(gt(conversations.updatedAt, lastRun))
    .all();

  if (recentConvs.length === 0) {
    writeTimestamp(LAST_RUN_PATH, now);
    return 0;
  }

  let summarized = 0;

  for (const conv of recentConvs) {
    let formatted: string;

    try {
      if (!conv.sdkSessionId) throw new Error("No SDK session");
      const sdkMessages = await getSessionMessages(conv.sdkSessionId, {
        dir: process.cwd(),
      });
      if (sdkMessages.length < 2) continue;
      formatted = formatSdkMessages(sdkMessages);
    } catch {
      const dbMessages = db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conv.id))
        .all();
      if (dbMessages.length < 2) continue;
      formatted = dbMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
    }

    try {
      const stream = query({
        prompt: `Summarize this conversation:\n\n${formatted}`,
        options: {
          model: cfg.model,
          systemPrompt: SUMMARIZER_PROMPT,
          tools: [],
          permissionMode: "dontAsk",
          maxTurns: cfg.phase1.maxTurns,
          maxBudgetUsd: cfg.phase1.maxBudgetUsd,
          thinking: { type: "disabled" },
        },
      });

      let summary = "";
      for await (const msg of stream) {
        if (msg.type === "result" && msg.subtype === "success") {
          summary = msg.result;
        }
      }

      if (!summary || summary.trim() === "(nothing)") continue;

      appendHistory({
        timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
        conversationId: conv.id,
        content: summary,
      });
      summarized++;
    } catch (err) {
      console.error(`Dream Phase 1: failed to summarize ${conv.id}:`, err);
    }
  }

  writeTimestamp(LAST_RUN_PATH, now);
  return summarized;
}

// ---------------------------------------------------------------------------
// Phase 2 — Edit memory files
// ---------------------------------------------------------------------------

const PHASE2_ANALYSIS_PROMPT = `Compare conversation history against current memory files. Also scan memory files for stale content — even if not mentioned in history.

Output one line per finding:
[SOUL] personality or communication style observation
[PROFILE] atomic fact about the user (not already in memory)
[KNOWLEDGE] atomic fact, decision, or project context
[SOUL-REMOVE] reason for removal
[PROFILE-REMOVE] reason for removal
[KNOWLEDGE-REMOVE] reason for removal

Rules:
- Atomic facts: "prefers TypeScript over JavaScript" not "discussed programming"
- Corrections replace old facts: [PROFILE] location is Tokyo, not Osaka
- [SOUL] is for tone, style, and persona changes (e.g. "user wants more detailed answers")
- Flag stale content: passed deadlines, completed tasks, superseded decisions
- Do not add: transient status, temporary errors, conversational filler

[SKIP] if nothing needs updating.`;

const PHASE2_EDIT_PROMPT = `Update memory files based on the analysis below.
- [SOUL] / [PROFILE] / [KNOWLEDGE] entries: add content to the appropriate file
- [*-REMOVE] entries: delete the corresponding content

File paths (relative to cwd):
- data/memory/soul.md
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

async function phase2EditMemory(
  unprocessed: HistoryEntry[],
): Promise<boolean> {
  if (unprocessed.length === 0) return false;

  const batch = unprocessed.slice(0, 20);

  const historyText = batch
    .map((e) => `[${e.timestamp}] ${e.content}`)
    .join("\n");

  const currentSoul = readMemoryFile("soul");
  const currentProfile = readMemoryFile("profile");
  const currentKnowledge = readMemoryFile("knowledge");

  const context = [
    `## Conversation History\n${historyText}`,
    `## Current soul.md (${currentSoul.length} chars)\n${currentSoul}`,
    `## Current profile.md (${currentProfile.length} chars)\n${currentProfile}`,
    `## Current knowledge.md (${currentKnowledge.length} chars)\n${currentKnowledge}`,
  ].join("\n\n");

  // Phase 2a: Analyze (single LLM call, no tools)
  let analysis = "";
  try {
    const analysisStream = query({
      prompt: context,
      options: {
        model: cfg.model,
        systemPrompt: PHASE2_ANALYSIS_PROMPT,
        tools: [],
        permissionMode: "dontAsk",
        maxTurns: cfg.phase2.analysisMaxTurns,
        maxBudgetUsd: cfg.phase2.analysisMaxBudgetUsd,
        thinking: { type: "disabled" },
      },
    });

    for await (const msg of analysisStream) {
      if (msg.type === "result" && msg.subtype === "success") {
        analysis = msg.result;
      }
    }
  } catch (err) {
    console.error("Dream Phase 2a (analysis) failed:", err);
    return false;
  }

  if (!analysis || analysis.trim() === "[SKIP]") {
    setLastDreamCursor(batch[batch.length - 1].cursor);
    return false;
  }

  // Phase 2b: Edit files via SDK agent with Read + Edit tools
  const editContext = [
    `## Analysis Result\n${analysis}`,
    `## Current soul.md\n${currentSoul}`,
    `## Current profile.md\n${currentProfile}`,
    `## Current knowledge.md\n${currentKnowledge}`,
  ].join("\n\n");

  try {
    const editStream = query({
      prompt: editContext,
      options: {
        model: cfg.model,
        systemPrompt: PHASE2_EDIT_PROMPT,
        allowedTools: ["Read", "Edit"],
        permissionMode: "dontAsk",
        maxTurns: cfg.phase2.editMaxTurns,
        maxBudgetUsd: cfg.phase2.editMaxBudgetUsd,
        thinking: { type: "disabled" },
        cwd: process.cwd(),
      },
    });

    for await (const msg of editStream) {
      if (msg.type === "result") {
        console.log(
          `Dream Phase 2b: ${msg.subtype}, turns=${msg.num_turns}, cost=$${msg.total_cost_usd}`,
        );
      }
    }
  } catch (err) {
    console.error("Dream Phase 2b (edit) failed:", err);
    return false;
  }

  const newCursor = batch[batch.length - 1].cursor;
  setLastDreamCursor(newCursor);
  writeTimestamp(LAST_PHASE2_PATH, new Date());
  compactHistory(newCursor);

  await gitCommitMemory(batch[batch.length - 1].timestamp);

  return true;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDream(): Promise<{
  summarized: number;
  edited: boolean;
}> {
  const summarized = await phase1Summarize();

  const unprocessed = readHistorySince(getLastDreamCursor());
  const timeSinceLastPhase2 =
    Date.now() - readTimestamp(LAST_PHASE2_PATH).getTime();
  let edited = false;

  if (
    unprocessed.length > 0 &&
    (unprocessed.length >= cfg.phase2.minEntries ||
      timeSinceLastPhase2 >= cfg.phase2.maxDelayMs)
  ) {
    edited = await phase2EditMemory(unprocessed);
  }

  if (summarized > 0 || edited) {
    console.log(`Dream: summarized=${summarized}, edited=${edited}`);
  }

  return { summarized, edited };
}

// ---------------------------------------------------------------------------
// SDK transcript normalization
// ---------------------------------------------------------------------------

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

function extractText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n");
  }
  return "";
}
