import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("enforceRateLimit", () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRateLimitModule() {
    vi.resetModules();
    return import("@/lib/rate-limit");
  }

  function buildRequest(headers?: HeadersInit) {
    return new NextRequest("http://localhost/api/auth/login", { headers });
  }

  it("allows requests until the limit is exceeded", async () => {
    const { enforceRateLimit } = await loadRateLimitModule();
    const request = buildRequest({
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    });
    const options = { key: "auth:login", limit: 2, windowMs: 1_000 };

    expect(enforceRateLimit(request, options)).toBeNull();
    expect(enforceRateLimit(request, options)).toBeNull();

    const response = enforceRateLimit(request, options);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("1");
    expect(await response?.json()).toEqual({
      error: "Too many attempts. Try again later.",
    });
  });

  it("resets a bucket after the window expires", async () => {
    const { enforceRateLimit } = await loadRateLimitModule();
    const request = buildRequest({ "x-real-ip": "127.0.0.1" });
    const options = { key: "auth:setup", limit: 1, windowMs: 1_000 };

    expect(enforceRateLimit(request, options)).toBeNull();
    expect(enforceRateLimit(request, options)?.status).toBe(429);

    now += 1_001;

    expect(enforceRateLimit(request, options)).toBeNull();
  });

  it("falls back to a local bucket when no IP headers are present", async () => {
    const { enforceRateLimit } = await loadRateLimitModule();
    const request = buildRequest();
    const options = { key: "auth:recover", limit: 1, windowMs: 5_000 };

    expect(enforceRateLimit(request, options)).toBeNull();
    expect(enforceRateLimit(request, options)?.status).toBe(429);
  });
});
