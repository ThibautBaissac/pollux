import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { buildJsonRequest } from "../helpers/requests";

describe("dream/run API route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute(options: {
    requestError?: Response | null;
    authError?: Response | null;
    runDream?: () => Promise<{ summarized: number; edited: boolean }>;
  } = {}) {
    const runDream = vi.fn(
      options.runDream ??
        (async () => ({ summarized: 0, edited: false })),
    );

    vi.resetModules();
    vi.doMock("@/lib/request-guards", () => ({
      requireTrustedRequest: () => options.requestError ?? null,
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireAuth: async () => options.authError ?? null,
    }));

    class DreamAlreadyRunningError extends Error {
      constructor() {
        super("Dream is already running");
        this.name = "DreamAlreadyRunningError";
      }
    }

    vi.doMock("@/lib/dream", () => ({
      runDream,
      DreamAlreadyRunningError,
    }));

    return {
      runDream,
      DreamAlreadyRunningError,
      route: await import("@/app/api/dream/run/route"),
    };
  }

  function makeRequest() {
    return buildJsonRequest("http://localhost/api/dream/run", {});
  }

  it("rejects untrusted requests before doing any work", async () => {
    const { route, runDream } = await loadRoute({
      requestError: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await route.POST(makeRequest());

    expect(response.status).toBe(403);
    expect(runDream).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { route, runDream } = await loadRoute({
      authError: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await route.POST(makeRequest());

    expect(response.status).toBe(401);
    expect(runDream).not.toHaveBeenCalled();
  });

  it("returns 200 with summarized/edited/durationMs on success", async () => {
    const { route, runDream } = await loadRoute({
      runDream: async () => ({ summarized: 3, edited: true }),
    });

    const response = await route.POST(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.summarized).toBe(3);
    expect(body.edited).toBe(true);
    expect(typeof body.durationMs).toBe("number");
    expect(runDream).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when Dream is already running", async () => {
    const { route, DreamAlreadyRunningError } = await loadRoute({
      runDream: async () => {
        throw new DreamAlreadyRunningError();
      },
    });

    const response = await route.POST(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Dream is already running",
    });
  });

  it("returns 500 on unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { route } = await loadRoute({
      runDream: async () => {
        throw new Error("kaboom");
      },
    });

    const response = await route.POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Dream run failed" });
  });
});
