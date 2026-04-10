import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoveryCodes, sessions } from "@/lib/db/schema";
import { createMockCookieStore, type MockCookieStore } from "../helpers/mock-cookies";
import { buildJsonRequest } from "../helpers/requests";
import { createTestDb, type TestDbContext } from "../helpers/test-db";

describe("auth API routes", () => {
  let testDb: TestDbContext;
  let cookieStore: MockCookieStore;

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

  async function loadModules() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("next/headers", () => ({
      cookies: async () => cookieStore,
    }));

    const [
      auth,
      setupRoute,
      loginRoute,
      recoverRoute,
      changePasswordRoute,
      changeEmailRoute,
      regenerateRecoveryRoute,
      checkRoute,
      profileRoute,
      logoutRoute,
      logoutAllRoute,
    ] = await Promise.all([
      import("@/lib/auth"),
      import("@/app/api/auth/setup/route"),
      import("@/app/api/auth/login/route"),
      import("@/app/api/auth/recover/route"),
      import("@/app/api/auth/change-password/route"),
      import("@/app/api/auth/change-email/route"),
      import("@/app/api/auth/regenerate-recovery/route"),
      import("@/app/api/auth/check/route"),
      import("@/app/api/auth/profile/route"),
      import("@/app/api/auth/logout/route"),
      import("@/app/api/auth/logout-all/route"),
    ]);

    return {
      auth,
      setupRoute,
      loginRoute,
      recoverRoute,
      changePasswordRoute,
      changeEmailRoute,
      regenerateRecoveryRoute,
      checkRoute,
      profileRoute,
      logoutRoute,
      logoutAllRoute,
    };
  }

  it("completes setup, persists auth state, and creates a session", async () => {
    const { auth, setupRoute } = await loadModules();

    const response = await setupRoute.POST(
      buildJsonRequest("http://localhost/api/auth/setup", {
        email: "ada@example.com",
        password: "hunter22",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recoveryCodes).toHaveLength(8);
    expect(auth.isSetupComplete()).toBe(true);
    expect(auth.getEmail()).toBe("ada@example.com");
    expect(cookieStore.get("session")?.value).toBeTruthy();
    expect(testDb.db.select().from(recoveryCodes).all()).toHaveLength(8);
  });

  it("rejects repeated setup attempts", async () => {
    const { auth, setupRoute } = await loadModules();
    await auth.changePassword("hunter22");

    const response = await setupRoute.POST(
      buildJsonRequest("http://localhost/api/auth/setup", {
        email: "ada@example.com",
        password: "hunter22",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Setup already complete" });
  });

  it("rate-limits repeated setup attempts from the same client", async () => {
    const { setupRoute } = await loadModules();
    let response: Response | undefined;

    for (let attempt = 0; attempt < 11; attempt++) {
      response = await setupRoute.POST(
        buildJsonRequest(
          "http://localhost/api/auth/setup",
          { email: "invalid", password: "hunter22" },
          { headers: { "x-forwarded-for": "10.1.1.1" } },
        ),
      );
    }

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBeTruthy();
  });

  it("logs in after setup and rejects invalid passwords", async () => {
    const { auth, loginRoute } = await loadModules();
    await auth.changePassword("hunter22");

    const invalid = await loginRoute.POST(
      buildJsonRequest("http://localhost/api/auth/login", {
        password: "wrong",
      }),
    );
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: "Invalid password" });

    const valid = await loginRoute.POST(
      buildJsonRequest("http://localhost/api/auth/login", {
        password: "hunter22",
      }),
    );

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ success: true });
    expect(cookieStore.get("session")?.value).toBeTruthy();
  });

  it("recovers an account, rotates sessions, and updates the password", async () => {
    const { auth, recoverRoute } = await loadModules();
    await auth.changePassword("hunter22");
    const { codes, hashes } = await auth.generateRecoveryCodes();
    auth.storeRecoveryCodes(hashes);
    await auth.createSession();
    cookieStore.delete("session");
    await auth.createSession();

    const oldSessionCount = testDb.db.select().from(sessions).all().length;

    const response = await recoverRoute.POST(
      buildJsonRequest("http://localhost/api/auth/recover", {
        code: codes[0],
        newPassword: "new-password-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await auth.verifyPassword("new-password-1", auth.getPasswordHash()!))
      .toBe(true);
    expect(testDb.db.select().from(sessions).all()).toHaveLength(1);
    expect(oldSessionCount).toBe(2);
    expect(await auth.verifyRecoveryCode(codes[0])).toBe(false);
  });

  it("changes password for authenticated users and recreates the session", async () => {
    const { auth, changePasswordRoute } = await loadModules();
    await auth.changePassword("hunter22");
    await auth.createSession();

    const response = await changePasswordRoute.POST(
      buildJsonRequest("http://localhost/api/auth/change-password", {
        currentPassword: "hunter22",
        newPassword: "new-password-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await auth.verifyPassword("new-password-1", auth.getPasswordHash()!))
      .toBe(true);
    expect(testDb.db.select().from(sessions).all()).toHaveLength(1);
  });

  it("changes email for authenticated users", async () => {
    const { auth, changeEmailRoute } = await loadModules();
    await auth.changePassword("hunter22");
    await auth.createSession();

    const response = await changeEmailRoute.POST(
      buildJsonRequest("http://localhost/api/auth/change-email", {
        currentPassword: "hunter22",
        email: "grace@example.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(auth.getEmail()).toBe("grace@example.com");
  });

  it("regenerates recovery codes for authenticated users", async () => {
    const { auth, regenerateRecoveryRoute } = await loadModules();
    await auth.changePassword("hunter22");
    await auth.createSession();
    const initial = await auth.generateRecoveryCodes();
    auth.storeRecoveryCodes(initial.hashes);

    const response = await regenerateRecoveryRoute.POST(
      buildJsonRequest("http://localhost/api/auth/regenerate-recovery", {
        currentPassword: "hunter22",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recoveryCodes).toHaveLength(8);
    expect(testDb.db.select().from(recoveryCodes).all()).toHaveLength(8);
  });

  it("reports setup and authentication status", async () => {
    const { auth, checkRoute } = await loadModules();

    const beforeSetup = await checkRoute.GET();
    expect(await beforeSetup.json()).toEqual({
      authenticated: false,
      setupRequired: true,
    });

    await auth.changePassword("hunter22");
    await auth.createSession();

    const afterSetup = await checkRoute.GET();
    expect(await afterSetup.json()).toEqual({
      authenticated: true,
      setupRequired: false,
    });
  });

  it("returns the current profile only when authenticated", async () => {
    const { auth, profileRoute } = await loadModules();
    await auth.changePassword("hunter22");
    auth.setEmail("ada@example.com");

    const unauthorized = await profileRoute.GET();
    expect(unauthorized.status).toBe(401);

    await auth.createSession();

    const authorized = await profileRoute.GET();
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ email: "ada@example.com" });
  });

  it("logs out the current session", async () => {
    const { auth, logoutRoute } = await loadModules();
    await auth.changePassword("hunter22");
    await auth.createSession();

    const response = await logoutRoute.POST(
      buildJsonRequest("http://localhost/api/auth/logout", {}),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(testDb.db.select().from(sessions).all()).toEqual([]);
    expect(cookieStore.has("session")).toBe(false);
  });

  it("logs out all sessions", async () => {
    const { auth, logoutAllRoute } = await loadModules();
    await auth.changePassword("hunter22");
    await auth.createSession();
    cookieStore.delete("session");
    await auth.createSession();

    const response = await logoutAllRoute.POST(
      buildJsonRequest("http://localhost/api/auth/logout-all", {}),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(testDb.db.select().from(sessions).all()).toEqual([]);
    expect(cookieStore.has("session")).toBe(false);
  });
});
