import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { dream } from "./dream-config";

export const MEMORY_DIR = join(process.cwd(), "data", "memory");

export type MemoryFile = "profile" | "knowledge";

const PATHS: Record<MemoryFile, string> = {
  profile: join(MEMORY_DIR, "profile.md"),
  knowledge: join(MEMORY_DIR, "knowledge.md"),
};

const DEFAULTS: Record<MemoryFile, string> = {
  profile: `# User Profile

Tell Pollux about yourself: your name, preferences, and anything it should always know.
`,
  knowledge: `# Knowledge Base

Add facts about yourself here. Pollux will use this information in every conversation.
`,
};

// ---------------------------------------------------------------------------
// Per-file read/write
// ---------------------------------------------------------------------------

export function readMemoryFile(file: MemoryFile): string {
  try {
    return readFileSync(PATHS[file], "utf-8");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      mkdirSync(MEMORY_DIR, { recursive: true });
      writeFileSync(PATHS[file], DEFAULTS[file], "utf-8");
      return DEFAULTS[file];
    }
    throw err;
  }
}

export function writeMemoryFile(file: MemoryFile, content: string): void {
  writeFileSync(PATHS[file], content, "utf-8");
}

// ---------------------------------------------------------------------------
// Combined memory for system prompt injection
// ---------------------------------------------------------------------------

export function readMemory(): string {
  const profile = readMemoryFile("profile");
  const knowledge = readMemoryFile("knowledge");

  const dreamCursor = getLastDreamCursor();
  const recent = readHistorySince(dreamCursor).slice(-dream.recentHistoryLimit);
  const recentSection =
    recent.length > 0
      ? `\n\n## Recent History\n${recent.map((e) => `- [${e.timestamp}] ${e.content}`).join("\n")}`
      : "";

  return `## User Profile\n${profile}\n\n## Knowledge Base\n${knowledge}${recentSection}`;
}

// ---------------------------------------------------------------------------
// history.jsonl — appended by Phase 1, consumed by Phase 2
// ---------------------------------------------------------------------------

const HISTORY_PATH = join(MEMORY_DIR, "history.jsonl");
const CURSOR_PATH = join(MEMORY_DIR, ".dream_cursor");

export interface HistoryEntry {
  cursor: number;
  timestamp: string;
  conversationId: string;
  content: string;
}

export function appendHistory(
  entry: Omit<HistoryEntry, "cursor">,
): number {
  let nextCursor = 1;
  try {
    const data = readFileSync(HISTORY_PATH, "utf-8").trim();
    if (data) {
      const lines = data.split("\n");
      const last = JSON.parse(lines[lines.length - 1]) as HistoryEntry;
      nextCursor = last.cursor + 1;
    }
  } catch {
    // File doesn't exist yet — start at 1
  }

  const full: HistoryEntry = { cursor: nextCursor, ...entry };
  appendFileSync(HISTORY_PATH, JSON.stringify(full) + "\n", "utf-8");
  return nextCursor;
}

export function readHistorySince(cursor: number): HistoryEntry[] {
  try {
    const data = readFileSync(HISTORY_PATH, "utf-8").trim();
    if (!data) return [];
    return data
      .split("\n")
      .map((line) => JSON.parse(line) as HistoryEntry)
      .filter((e) => e.cursor > cursor);
  } catch {
    return [];
  }
}

export function getLastDreamCursor(): number {
  try {
    return parseInt(readFileSync(CURSOR_PATH, "utf-8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export function setLastDreamCursor(cursor: number): void {
  writeFileSync(CURSOR_PATH, String(cursor), "utf-8");
}

/** Remove processed entries from history.jsonl to keep it bounded. */
export function compactHistory(cursor: number): void {
  try {
    const data = readFileSync(HISTORY_PATH, "utf-8").trim();
    if (!data) return;
    const remaining = data
      .split("\n")
      .filter((line) => {
        const entry = JSON.parse(line) as HistoryEntry;
        return entry.cursor > cursor;
      });
    writeFileSync(
      HISTORY_PATH,
      remaining.length > 0 ? remaining.join("\n") + "\n" : "",
      "utf-8",
    );
  } catch {
    // File doesn't exist or is corrupt — nothing to compact
  }
}
