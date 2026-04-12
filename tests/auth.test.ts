import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authConfig, recoveryCodes, sessions } from "@/lib/db/schema";
import { createMockCookieStore } from "./helpers/mock-cookies";
import { createTestDb, type TestDbContext } from "./helpers/test-db";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("auth", () => {
  let testDb: TestDbContext;
  let cookieStore = createMockCookieStore();

  beforeEach(() => {
    testDb = createTestDb();
    cookieStore = createMockCookieStore();
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(testDb.rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  async function loadAuthModule() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("next/headers", () => ({
      cookies: async () => cookieStore,
    }));
    return import("@/lib/auth");
  }

  it("hashes and verifies passwords", async () => {
    const { hashPassword, verifyPassword } = await loadAuthModule();

    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toContain(":");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true,
    );
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("rejects malformed password hashes", async () => {
    const { verifyPassword } = await loadAuthModule();

    expect(await verifyPassword("test", "missing-delimiter")).toBe(false);
    expect(await verifyPassword("test", "abcd:1234")).toBe(false);
  });

  it("creates and validates sessions with hashed tokens", async () => {
    const { createSession, validateSession } = await loadAuthModule();

    const token = await createSession();

    expect(token).toHaveLength(64);
    expect(cookieStore.get("session")?.value).toBe(token);
    expect(await validateSession()).toBe(true);

    const stored = testDb.db.select().from(sessions).get();
    expect(stored?.token).not.toBe(token);
  });

  it("rejects session cookies whose value matches a stored hash directly", async () => {
    const { createSession, validateSession } = await loadAuthModule();

    const rawToken = await createSession();
    const stored = testDb.db.select().from(sessions).get();
    expect(stored?.token).toBeTruthy();
    expect(stored?.token).not.toBe(rawToken);

    // Replay the stored hash as if it were a cookie value — must not
    // authenticate now that the plaintext fallback is gone.
    cookieStore.set("session", stored!.token);

    expect(await validateSession()).toBe(false);
  });

  it("rejects legacy plain-text session tokens after migration", async () => {
    const { validateSession } = await loadAuthModule();
    const legacyToken = "legacy-token";
    const now = new Date();

    testDb.db
      .insert(sessions)
      .values({
        token: legacyToken,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      })
      .run();
    cookieStore.set("session", legacyToken);

    expect(await validateSession()).toBe(false);
  });

  it("rejects expired sessions and removes them", async () => {
    const { validateSession } = await loadAuthModule();
    const now = new Date();
    const rawToken = "expired-token";

    testDb.db
      .insert(sessions)
      .values({
        token: hashToken(rawToken),
        createdAt: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 60_000),
      })
      .run();
    cookieStore.set("session", rawToken);

    expect(await validateSession()).toBe(false);
    expect(testDb.db.select().from(sessions).all()).toEqual([]);
  });

  it("destroys the current session and clears the cookie", async () => {
    const { createSession, destroySession } = await loadAuthModule();

    await createSession();
    expect(testDb.db.select().from(sessions).all()).toHaveLength(1);

    await destroySession();

    expect(testDb.db.select().from(sessions).all()).toEqual([]);
    expect(cookieStore.has("session")).toBe(false);
  });

  it("stores profile config and reports setup state", async () => {
    const {
      changePassword,
      getEmail,
      getPasswordHash,
      isSetupComplete,
      setEmail,
    } = await loadAuthModule();

    expect(isSetupComplete()).toBe(false);

    setEmail("ada@example.com");
    await changePassword("hunter22");

    expect(getEmail()).toBe("ada@example.com");
    expect(getPasswordHash()).toBeTruthy();
    expect(isSetupComplete()).toBe(true);

    const stored = testDb.db.select().from(authConfig).all();
    expect(stored).toHaveLength(2);
  });

  it("generates, stores, and consumes recovery codes once", async () => {
    const {
      generateRecoveryCodes,
      storeRecoveryCodes,
      verifyRecoveryCode,
    } = await loadAuthModule();

    const { codes, entries } = await generateRecoveryCodes();
    storeRecoveryCodes(entries);

    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    const stored = testDb.db.select().from(recoveryCodes).all();
    expect(stored).toHaveLength(8);
    expect(stored.every((row) => row.lookupPrefix?.length === 4)).toBe(true);

    expect(await verifyRecoveryCode(codes[0])).toBe(true);
    expect(await verifyRecoveryCode(codes[0])).toBe(false);
    expect(await verifyRecoveryCode("bogus-code")).toBe(false);
  });

  it("verifies legacy recovery codes that have no lookup prefix", async () => {
    const { hashPassword, verifyRecoveryCode } = await loadAuthModule();
    const legacyCode = "aaaa-bbbb-cccc-dddd";
    const hash = await hashPassword(legacyCode);

    testDb.db
      .insert(recoveryCodes)
      .values({
        id: "legacy-1",
        codeHash: hash,
        lookupPrefix: null,
        used: 0,
        createdAt: new Date(),
      })
      .run();

    expect(await verifyRecoveryCode(legacyCode)).toBe(true);
    expect(await verifyRecoveryCode(legacyCode)).toBe(false);
  });

  it("destroys all sessions", async () => {
    const { createSession, destroyAllSessions } = await loadAuthModule();

    await createSession();
    cookieStore.delete("session");
    await createSession();
    expect(testDb.db.select().from(sessions).all()).toHaveLength(2);

    destroyAllSessions();

    expect(testDb.db.select().from(sessions).all()).toEqual([]);
  });
});
