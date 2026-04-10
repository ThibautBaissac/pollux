import { describe, expect, it } from "vitest";

import { RATE_LIMITS } from "@/lib/rate-limit-config";

describe("RATE_LIMITS", () => {
  it("defines the auth rate limit settings", () => {
    expect(RATE_LIMITS.login).toEqual({
      key: "auth:login",
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });
    expect(RATE_LIMITS.recover).toEqual({
      key: "auth:recover",
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    expect(RATE_LIMITS.changePassword.limit).toBe(8);
    expect(RATE_LIMITS.changeEmail.limit).toBe(8);
    expect(RATE_LIMITS.regenerateRecovery.limit).toBe(8);
  });
});
