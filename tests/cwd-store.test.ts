import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDb, type TestDbContext } from "./helpers/test-db";

describe("cwd-store", () => {
  let testDb: TestDbContext;
  let tempDir: string;

  beforeEach(() => {
    testDb = createTestDb();
    tempDir = mkdtempSync(join(tmpdir(), "pollux-cwd-"));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function loadCwdStore() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    return import("@/lib/cwd-store");
  }

  it("returns process.cwd() when no value is set", async () => {
    const { getCwd } = await loadCwdStore();

    expect(getCwd()).toBe(process.cwd());
  });

  it("setCwd persists and getCwd reads it back", async () => {
    const { getCwd, setCwd } = await loadCwdStore();

    setCwd(tempDir);
    expect(getCwd()).toBe(tempDir);
  });

  it("setCwd overwrites previous value", async () => {
    const { getCwd, setCwd } = await loadCwdStore();
    const secondDir = mkdtempSync(join(tmpdir(), "pollux-cwd2-"));

    try {
      setCwd(tempDir);
      setCwd(secondDir);
      expect(getCwd()).toBe(secondDir);
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("setCwd rejects non-existent path", async () => {
    const { setCwd } = await loadCwdStore();

    expect(() => setCwd("/nonexistent/path/abc123")).toThrow(
      "Path does not exist",
    );
  });

  it("setCwd rejects file path (not directory)", async () => {
    const { setCwd } = await loadCwdStore();
    const filePath = join(tempDir, "file.txt");
    writeFileSync(filePath, "hello");

    expect(() => setCwd(filePath)).toThrow("Path is not a directory");
  });

  it("getCwd falls back to process.cwd() when stored path no longer exists", async () => {
    const { getCwd, setCwd } = await loadCwdStore();
    const ephemeralDir = mkdtempSync(join(tmpdir(), "pollux-ephemeral-"));

    setCwd(ephemeralDir);
    expect(getCwd()).toBe(ephemeralDir);

    rmSync(ephemeralDir, { recursive: true, force: true });
    expect(getCwd()).toBe(process.cwd());
  });
});
