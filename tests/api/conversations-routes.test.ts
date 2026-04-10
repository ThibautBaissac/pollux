import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { conversations, messages } from "@/lib/db/schema";
import { buildJsonRequest, buildRequest } from "../helpers/requests";
import { createTestDb, type TestDbContext } from "../helpers/test-db";

describe("conversation API routes", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  function seedConversation(id: string, title: string, updatedAt: Date) {
    testDb.db
      .insert(conversations)
      .values({
        id,
        title,
        sdkSessionId: null,
        createdAt: updatedAt,
        updatedAt,
      })
      .run();
  }

  async function loadRoutes(
    requireAuthImpl: () => Promise<Response | null> = async () => null,
  ) {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireAuth: requireAuthImpl,
    }));

    const [collectionRoute, itemRoute] = await Promise.all([
      import("@/app/api/conversations/route"),
      import("@/app/api/conversations/[id]/route"),
    ]);

    return { collectionRoute, itemRoute };
  }

  it("lists conversations ordered by most recent update", async () => {
    const { collectionRoute } = await loadRoutes();
    seedConversation("older", "Older", new Date("2026-04-10T10:00:00.000Z"));
    seedConversation("newer", "Newer", new Date("2026-04-10T12:00:00.000Z"));

    const response = await collectionRoute.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.map((row: { id: string }) => row.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(body[0].updatedAt).toBe("2026-04-10T12:00:00.000Z");
  });

  it("returns a conversation with parsed tool uses", async () => {
    const { itemRoute } = await loadRoutes();
    const now = new Date("2026-04-10T12:00:00.000Z");
    seedConversation("conv-1", "Hello", now);
    testDb.db
      .insert(messages)
      .values([
        {
          id: "msg-1",
          conversationId: "conv-1",
          role: "user",
          content: "Hi",
          toolUses: null,
          createdAt: now,
        },
        {
          id: "msg-2",
          conversationId: "conv-1",
          role: "assistant",
          content: "Hello",
          toolUses: JSON.stringify([{ name: "WebSearch" }]),
          createdAt: new Date("2026-04-10T12:00:01.000Z"),
        },
      ])
      .run();

    const response = await itemRoute.GET(
      buildRequest("http://localhost/api/conversations/conv-1"),
      { params: Promise.resolve({ id: "conv-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("conv-1");
    expect(body.messages[1].toolUses).toEqual([{ name: "WebSearch" }]);
  });

  it("returns not found for missing conversations", async () => {
    const { itemRoute } = await loadRoutes();

    const response = await itemRoute.GET(
      buildRequest("http://localhost/api/conversations/missing"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("patches titles with trimming and max length", async () => {
    const { itemRoute } = await loadRoutes();
    seedConversation("conv-1", "Old title", new Date("2026-04-10T10:00:00.000Z"));

    const response = await itemRoute.PATCH(
      buildJsonRequest("http://localhost/api/conversations/conv-1", {
        title: `  ${"A".repeat(120)}  `,
      }, { method: "PATCH" }),
      { params: Promise.resolve({ id: "conv-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.title).toBe("A".repeat(100));
  });

  it("deletes conversations and cascades messages", async () => {
    const { itemRoute } = await loadRoutes();
    const now = new Date();
    seedConversation("conv-1", "Delete me", now);
    testDb.db
      .insert(messages)
      .values({
        id: "msg-1",
        conversationId: "conv-1",
        role: "user",
        content: "Hi",
        toolUses: null,
        createdAt: now,
      })
      .run();

    const response = await itemRoute.DELETE(
      buildJsonRequest(
        "http://localhost/api/conversations/conv-1",
        {},
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: "conv-1" }) },
    );

    expect(response.status).toBe(204);
    expect(testDb.db.select().from(conversations).all()).toEqual([]);
    expect(testDb.db.select().from(messages).all()).toEqual([]);
  });

  it("surfaces auth failures from the collection route", async () => {
    const { collectionRoute } = await loadRoutes(async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await collectionRoute.GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
