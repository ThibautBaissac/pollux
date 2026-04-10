import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { buildJsonRequest, buildRequest } from "../helpers/requests";
import { createTestDb, type TestDbContext } from "../helpers/test-db";

describe("memory API route", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(testDb.rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  async function loadMemoryRoute(
    requireAuthImpl: () => Promise<Response | null> = async () => null,
  ) {
    vi.resetModules();
    vi.doMock("@/lib/auth-guard", () => ({
      requireAuth: requireAuthImpl,
    }));
    return import("@/app/api/memory/route");
  }

  it("reads the default knowledge file", async () => {
    const route = await loadMemoryRoute();

    const response = await route.GET(
      buildRequest("http://localhost/api/memory?file=knowledge"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.content).toContain("# Knowledge Base");
  });

  it("writes and reads the profile memory file", async () => {
    const route = await loadMemoryRoute();

    const putResponse = await route.PUT(
      buildJsonRequest("http://localhost/api/memory", {
        file: "profile",
        content: "# User Profile\n\nAda\n",
      }),
    );
    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toEqual({ ok: true });

    const getResponse = await route.GET(
      buildRequest("http://localhost/api/memory?file=profile"),
    );
    expect(await getResponse.json()).toEqual({
      content: "# User Profile\n\nAda\n",
    });
  });

  it("rejects invalid PUT payloads", async () => {
    const route = await loadMemoryRoute();

    const response = await route.PUT(
      buildJsonRequest("http://localhost/api/memory", {
        file: "knowledge",
        content: 123,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Content must be a string",
    });
  });

  it("returns the auth error from the guard", async () => {
    const route = await loadMemoryRoute(async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await route.GET(
      buildRequest("http://localhost/api/memory?file=knowledge"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
