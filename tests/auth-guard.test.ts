import { afterEach, describe, expect, it, vi } from "vitest";

describe("auth-guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadAuthGuardModule(mockedAuth: {
    getPasswordHash?: () => string | null;
    validateSession?: () => Promise<boolean>;
    verifyPassword?: (password: string, hash: string) => Promise<boolean>;
  } = {}) {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({
      getPasswordHash: mockedAuth.getPasswordHash ?? (() => null),
      validateSession:
        mockedAuth.validateSession ?? (async () => true),
      verifyPassword:
        mockedAuth.verifyPassword ?? (async () => true),
    }));
    return import("@/lib/auth-guard");
  }

  it("rejects unauthenticated requests", async () => {
    const { requireAuth } = await loadAuthGuardModule({
      validateSession: async () => false,
    });

    const response = await requireAuth();

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Unauthorized" });
  });

  it("requires a current password", async () => {
    const { requirePasswordConfirmation } = await loadAuthGuardModule();

    const response = await requirePasswordConfirmation(undefined);

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      error: "Current password is required",
    });
  });

  it("rejects incorrect current passwords", async () => {
    const { requirePasswordConfirmation } = await loadAuthGuardModule({
      getPasswordHash: () => "stored-hash",
      verifyPassword: async () => false,
    });

    const response = await requirePasswordConfirmation("wrong");

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({
      error: "Current password is incorrect",
    });
  });

  it("accepts the correct current password", async () => {
    const { requirePasswordConfirmation } = await loadAuthGuardModule({
      getPasswordHash: () => "stored-hash",
      verifyPassword: async () => true,
    });

    expect(await requirePasswordConfirmation("correct")).toBeNull();
  });
});
