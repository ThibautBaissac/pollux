import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  conversations,
  executions,
  messages,
  reminders,
} from "@/lib/db/schema";
import { createTestDb, type TestDbContext } from "./helpers/test-db";
import type { Reminder } from "@/types";

describe("notifications / executions", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  function seedConversation(id = "conv-1") {
    const now = new Date();
    testDb.db
      .insert(conversations)
      .values({ id, title: "Test", createdAt: now, updatedAt: now })
      .run();
    return id;
  }

  function seedAgentReminder(convId: string, id = "rem-1"): Reminder {
    const now = new Date();
    testDb.db
      .insert(reminders)
      .values({
        id,
        name: "Agent veille",
        message: "Research AI news",
        kind: "agent",
        scheduleType: "recurring",
        cronExpr: "0 9 * * *",
        nextRunAt: now,
        runningSince: now,
        timezone: "UTC",
        conversationId: convId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return {
      id,
      name: "Agent veille",
      message: "Research AI news",
      kind: "agent",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      scheduledAt: null,
      nextRunAt: now.toISOString(),
      lastRunAt: null,
      runningSince: now.toISOString(),
      timezone: "UTC",
      conversationId: convId,
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async function loadExecutions() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    return import("@/lib/executions");
  }

  async function loadReminders() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("@/lib/scheduled-agent", () => ({
      runScheduledAgent: vi.fn(async () => {}),
    }));
    return import("@/lib/reminders");
  }

  async function loadScheduledAgent() {
    vi.resetModules();
    vi.doUnmock("@/lib/scheduled-agent");
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("@/lib/memory", () => ({ readMemory: () => "mem" }));
    vi.doMock("@/lib/model-store", () => ({ getModel: () => "model" }));
    return import("@/lib/scheduled-agent");
  }

  // --- recordExecution / retention ---

  it("records an execution and returns its id", async () => {
    const { recordExecution } = await loadExecutions();
    const id = recordExecution({
      kind: "dream",
      summary: "Memory updated (3 entries)",
    });

    const row = testDb.db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .get();
    expect(row).toBeTruthy();
    expect(row!.kind).toBe("dream");
    expect(row!.summary).toBe("Memory updated (3 entries)");
    expect(row!.readAt).toBeNull();
  });

  it("caps the executions table at 500 rows, evicting the oldest", async () => {
    const { recordExecution } = await loadExecutions();
    // Insert 501 rows with distinct firedAt so the oldest is deterministic.
    for (let i = 0; i < 501; i++) {
      recordExecution({
        kind: "dream",
        summary: `entry-${i}`,
        firedAt: new Date(2026, 0, 1, 0, 0, i),
      });
    }
    const all = testDb.db.select().from(executions).all();
    expect(all).toHaveLength(500);
    const summaries = new Set(all.map((r) => r.summary));
    expect(summaries.has("entry-0")).toBe(false);
    expect(summaries.has("entry-500")).toBe(true);
  });

  // --- listExecutions / countUnread / markRead ---

  it("lists executions ordered newest first and counts unread", async () => {
    const { recordExecution, listExecutions, countUnread } =
      await loadExecutions();
    recordExecution({
      kind: "dream",
      summary: "old",
      firedAt: new Date(2026, 0, 1, 0, 0, 0),
    });
    recordExecution({
      kind: "dream",
      summary: "new",
      firedAt: new Date(2026, 0, 1, 0, 1, 0),
    });

    const items = listExecutions();
    expect(items).toHaveLength(2);
    expect(items[0].summary).toBe("new");
    expect(items[1].summary).toBe("old");
    expect(countUnread()).toBe(2);
  });

  it("marks an execution as read and decrements the unread count", async () => {
    const { recordExecution, markRead, countUnread } = await loadExecutions();
    const id = recordExecution({ kind: "dream", summary: "x" });
    expect(countUnread()).toBe(1);
    expect(markRead(id)).toBe(true);
    expect(countUnread()).toBe(0);
  });

  it("returns false when marking a missing execution", async () => {
    const { markRead } = await loadExecutions();
    expect(markRead("nonexistent")).toBe(false);
  });

  // --- reminder_notify write site ---

  it("records a reminder_notify execution tied to the inserted message", async () => {
    const { checkDueReminders, createReminder } = await loadReminders();
    const convId = seedConversation();
    const past = new Date(Date.now() - 60_000).toISOString();
    createReminder({
      name: "Daily ping",
      message: "hello",
      scheduleType: "once",
      scheduledAt: past,
      conversationId: convId,
    });

    checkDueReminders();

    const rows = testDb.db.select().from(executions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("reminder_notify");
    expect(rows[0].summary).toBe("Daily ping");
    expect(rows[0].conversationId).toBe(convId);

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(rows[0].messageId).toBe(msgs[0].id);
  });

  // --- reminder_agent write site ---

  it("records a reminder_agent execution when the agent completes successfully", async () => {
    const convId = seedConversation();
    const reminder = seedAgentReminder(convId);

    vi.doMock("@/lib/agent", () => ({
      startAgent: () =>
        (async function* () {
          yield { type: "system", subtype: "init", session_id: "s1" };
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Here's the summary." }] },
          };
          yield { type: "result", total_cost_usd: 0.01, num_turns: 1 };
        })(),
    }));

    const { runScheduledAgent } = await loadScheduledAgent();
    await runScheduledAgent(reminder);

    const rows = testDb.db.select().from(executions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("reminder_agent");
    expect(rows[0].sourceId).toBe("rem-1");
    expect(rows[0].summary).toBe("Agent veille");
    expect(rows[0].conversationId).toBe(convId);
    // messageId should point to the assistant message we persisted.
    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    const assistantMsg = msgs.find((m) => m.role === "assistant");
    expect(rows[0].messageId).toBe(assistantMsg!.id);
  });

  it("does not record an execution when the agent throws", async () => {
    const convId = seedConversation();
    const reminder = seedAgentReminder(convId);

    vi.doMock("@/lib/agent", () => ({
      startAgent: () => {
        throw new Error("SDK exploded");
      },
    }));

    const { runScheduledAgent } = await loadScheduledAgent();
    await runScheduledAgent(reminder);

    expect(testDb.db.select().from(executions).all()).toHaveLength(0);
  });

  it("does not record an execution when the stream never emits a result frame", async () => {
    const convId = seedConversation();
    const reminder = seedAgentReminder(convId);

    vi.doMock("@/lib/agent", () => ({
      startAgent: () =>
        (async function* () {
          yield { type: "system", subtype: "init", session_id: "s1" };
          // no result frame — stream ends early
        })(),
    }));

    const { runScheduledAgent } = await loadScheduledAgent();
    await runScheduledAgent(reminder);

    expect(testDb.db.select().from(executions).all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// API route auth
// ---------------------------------------------------------------------------

describe("notifications API auth", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  async function loadRoutes(
    requireAuthImpl: () => Promise<Response | null>,
  ) {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("@/lib/auth-guard", () => ({ requireAuth: requireAuthImpl }));

    const [collectionRoute, itemRoute] = await Promise.all([
      import("@/app/api/notifications/route"),
      import("@/app/api/notifications/[id]/read/route"),
    ]);
    return { collectionRoute, itemRoute };
  }

  it("GET /api/notifications returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    const { collectionRoute } = await loadRoutes(async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await collectionRoute.GET();
    expect(res.status).toBe(401);
  });

  it("POST /api/notifications/[id]/read returns 401 when not authenticated", async () => {
    const { NextResponse, NextRequest } = await import("next/server");
    const { itemRoute } = await loadRoutes(async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const req = new NextRequest("http://localhost/api/notifications/abc/read", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
      },
    });
    const res = await itemRoute.POST(req, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(401);
  });
});
