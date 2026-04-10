import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("memory", () => {
  let rootDir = "";

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "pollux-memory-"));
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(rootDir, { recursive: true, force: true });
  });

  async function loadMemoryModule() {
    vi.resetModules();
    return import("@/lib/memory");
  }

  it("creates missing memory files with defaults", async () => {
    const { MEMORY_DIR, readMemoryFile } = await loadMemoryModule();

    const profile = readMemoryFile("profile");
    const knowledge = readMemoryFile("knowledge");

    expect(profile).toContain("# User Profile");
    expect(knowledge).toContain("# Knowledge Base");
    expect(existsSync(join(MEMORY_DIR, "profile.md"))).toBe(true);
    expect(existsSync(join(MEMORY_DIR, "knowledge.md"))).toBe(true);
  });

  it("returns empty history and a zero cursor before files exist", async () => {
    const { getLastDreamCursor, readHistorySince } = await loadMemoryModule();

    expect(readHistorySince(0)).toEqual([]);
    expect(getLastDreamCursor()).toBe(0);
  });

  it("appends, reads, compacts, and tracks cursor state", async () => {
    const {
      appendHistory,
      compactHistory,
      getLastDreamCursor,
      readHistorySince,
      readMemoryFile,
      setLastDreamCursor,
    } = await loadMemoryModule();

    readMemoryFile("profile");

    const first = appendHistory({
      timestamp: "2026-04-10T12:00:00.000Z",
      conversationId: "conv-1",
      content: "first event",
    });
    const second = appendHistory({
      timestamp: "2026-04-10T12:05:00.000Z",
      conversationId: "conv-1",
      content: "second event",
    });

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(readHistorySince(0).map((entry) => entry.cursor)).toEqual([1, 2]);

    setLastDreamCursor(2);
    expect(getLastDreamCursor()).toBe(2);

    compactHistory(1);

    const remaining = readHistorySince(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      cursor: 2,
      content: "second event",
    });
  });

  it("builds the combined memory prompt with recent history", async () => {
    const {
      appendHistory,
      readMemory,
      readMemoryFile,
      setLastDreamCursor,
      writeMemoryFile,
      MEMORY_DIR,
    } = await loadMemoryModule();

    readMemoryFile("profile");
    readMemoryFile("knowledge");
    writeMemoryFile("profile", "# User Profile\n\nAda\n");
    writeMemoryFile("knowledge", "# Knowledge Base\n\nLoves tests\n");

    appendHistory({
      timestamp: "2026-04-10T13:00:00.000Z",
      conversationId: "conv-2",
      content: "said hello",
    });
    setLastDreamCursor(0);

    const combined = readMemory();

    expect(combined).toContain("## User Profile");
    expect(combined).toContain("Ada");
    expect(combined).toContain("## Knowledge Base");
    expect(combined).toContain("Loves tests");
    expect(combined).toContain("## Recent History");
    expect(combined).toContain("[2026-04-10T13:00:00.000Z] said hello");
    expect(readFileSync(join(MEMORY_DIR, ".dream_cursor"), "utf-8")).toBe("0");
  });
});
