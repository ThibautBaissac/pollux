import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authConfig } from "@/lib/db/schema";
import { AVAILABLE_MODELS, DEFAULT_MODEL, isValidModel } from "@/lib/models";
import { createTestDb, type TestDbContext } from "./helpers/test-db";

describe("models (pure)", () => {
  it("exports AVAILABLE_MODELS with correct entries", () => {
    expect(AVAILABLE_MODELS).toHaveLength(3);
    expect(AVAILABLE_MODELS.map((m) => m.id)).toEqual([
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]);
  });

  it("isValidModel accepts known models and rejects unknown ones", () => {
    expect(isValidModel("claude-opus-4-6")).toBe(true);
    expect(isValidModel("claude-sonnet-4-6")).toBe(true);
    expect(isValidModel("claude-haiku-4-5-20251001")).toBe(true);
    expect(isValidModel("gpt-4")).toBe(false);
    expect(isValidModel("")).toBe(false);
    expect(isValidModel("claude-sonnet-4-6-extra")).toBe(false);
  });
});

describe("model-store", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  async function loadModelStore() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    return import("@/lib/model-store");
  }

  it("returns DEFAULT_MODEL when no model is set", async () => {
    const { getModel } = await loadModelStore();

    expect(getModel()).toBe(DEFAULT_MODEL);
    expect(getModel()).toBe("claude-sonnet-4-6");
  });

  it("setModel persists and getModel reads it back", async () => {
    const { getModel, setModel } = await loadModelStore();

    setModel("claude-opus-4-6");
    expect(getModel()).toBe("claude-opus-4-6");

    setModel("claude-haiku-4-5-20251001");
    expect(getModel()).toBe("claude-haiku-4-5-20251001");
  });

  it("setModel overwrites previous value", async () => {
    const { getModel, setModel } = await loadModelStore();

    setModel("claude-opus-4-6");
    setModel("claude-sonnet-4-6");
    expect(getModel()).toBe("claude-sonnet-4-6");
  });

  it("setModel rejects invalid model", async () => {
    const { setModel } = await loadModelStore();

    expect(() => setModel("gpt-4")).toThrow("Invalid model");
  });

  it("getModel falls back to default for invalid stored value", async () => {
    const { getModel } = await loadModelStore();

    // Write an invalid value directly to the DB, bypassing setModel validation
    testDb.db
      .insert(authConfig)
      .values({ key: "model", value: "claude-nonexistent-99" })
      .run();

    expect(getModel()).toBe(DEFAULT_MODEL);
  });
});
