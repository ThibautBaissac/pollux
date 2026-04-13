import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDbContext } from "./helpers/test-db";

describe("runDream mutex", () => {
  let rootDir = "";
  let testDb: TestDbContext;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "pollux-dream-"));
    mkdirSync(join(rootDir, "data", "memory"), { recursive: true });
    testDb = createTestDb();
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  });

  async function loadDream() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    return import("@/lib/dream");
  }

  it("rejects a second runDream while one is in progress", async () => {
    const dream = await loadDream();

    const first = dream.runDream();
    expect(dream.isDreamInProgress()).toBe(true);

    await expect(dream.runDream()).rejects.toBeInstanceOf(
      dream.DreamAlreadyRunningError,
    );

    await first;
    expect(dream.isDreamInProgress()).toBe(false);
  });

  it("releases the lock so a subsequent runDream can succeed", async () => {
    const dream = await loadDream();

    await dream.runDream();
    expect(dream.isDreamInProgress()).toBe(false);

    // Second sequential call should not throw.
    await expect(dream.runDream()).resolves.toEqual({
      summarized: 0,
      edited: false,
    });
  });
});
