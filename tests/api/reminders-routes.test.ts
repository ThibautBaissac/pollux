import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { conversations, reminders } from "@/lib/db/schema";
import { buildJsonRequest, buildRequest } from "../helpers/requests";
import { createTestDb, type TestDbContext } from "../helpers/test-db";

describe("reminder API routes", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  function seedConversation(id: string, title: string) {
    const now = new Date("2026-04-10T10:00:00.000Z");
    testDb.db
      .insert(conversations)
      .values({
        id,
        title,
        sdkSessionId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  function seedReminder(
    id: string,
    overrides: Partial<typeof reminders.$inferInsert> = {},
  ) {
    const now = new Date("2026-04-10T10:00:00.000Z");
    testDb.db
      .insert(reminders)
      .values({
        id,
        name: "Daily review",
        message: "Review the inbox",
        kind: "notify",
        scheduleType: "recurring",
        cronExpr: "0 9 * * *",
        scheduledAt: null,
        nextRunAt: new Date("2026-04-11T09:00:00.000Z"),
        lastRunAt: null,
        runningSince: null,
        timezone: "UTC",
        conversationId: "conv-1",
        enabled: 1,
        createdAt: now,
        updatedAt: now,
        ...overrides,
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
      import("@/app/api/reminders/route"),
      import("@/app/api/reminders/[id]/route"),
    ]);

    return { collectionRoute, itemRoute };
  }

  it("lists reminders from the collection route", async () => {
    const { collectionRoute } = await loadRoutes();
    seedConversation("conv-1", "Ops");
    seedReminder("rem-1");

    const response = await collectionRoute.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "rem-1",
      name: "Daily review",
      scheduleType: "recurring",
    });
  });

  it("patches a reminder across all editable fields", async () => {
    const { itemRoute } = await loadRoutes();
    seedConversation("conv-1", "Ops");
    seedConversation("conv-2", "Research");
    seedReminder("rem-1");

    const response = await itemRoute.PATCH(
      buildJsonRequest(
        "http://localhost/api/reminders/rem-1",
        {
          name: "  Evening watch  ",
          message: "  Scan the changelog  ",
          kind: "agent",
          scheduleType: "once",
          scheduledAt: "2026-04-12T09:30:00.000Z",
          timezone: "Europe/Paris",
          conversationId: "conv-2",
          enabled: false,
        },
        { method: "PATCH" },
      ),
      { params: Promise.resolve({ id: "rem-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: "rem-1",
      name: "Evening watch",
      message: "Scan the changelog",
      kind: "agent",
      scheduleType: "once",
      cronExpr: null,
      timezone: "Europe/Paris",
      conversationId: "conv-2",
      enabled: false,
    });

    const expectedSec = Math.floor(
      new Date("2026-04-12T09:30:00.000Z").getTime() / 1000,
    );
    const scheduledSec = Math.floor(new Date(body.scheduledAt).getTime() / 1000);
    const nextRunSec = Math.floor(new Date(body.nextRunAt).getTime() / 1000);
    expect(scheduledSec).toBe(expectedSec);
    expect(nextRunSec).toBe(expectedSec);
  });

  it("returns validation errors from schedule updates", async () => {
    const { itemRoute } = await loadRoutes();
    seedConversation("conv-1", "Ops");
    seedReminder("rem-1");

    const response = await itemRoute.PATCH(
      buildJsonRequest(
        "http://localhost/api/reminders/rem-1",
        { cronExpr: "not a cron" },
        { method: "PATCH" },
      ),
      { params: Promise.resolve({ id: "rem-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid cron expression",
    });
  });

  it("returns not found for missing reminders", async () => {
    const { itemRoute } = await loadRoutes();

    const response = await itemRoute.PATCH(
      buildJsonRequest(
        "http://localhost/api/reminders/missing",
        { name: "Updated" },
        { method: "PATCH" },
      ),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("surfaces auth failures from reminder routes", async () => {
    const { itemRoute } = await loadRoutes(async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await itemRoute.GET(
      buildRequest("http://localhost/api/reminders/rem-1"),
      { params: Promise.resolve({ id: "rem-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
