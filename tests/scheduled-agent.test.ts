import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { conversations, messages, reminders } from "@/lib/db/schema";
import { createTestDb, type TestDbContext } from "./helpers/test-db";
import type { Reminder } from "@/types";

describe("scheduled agent runner", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  function seedConversation(id = "conv-1", sdkSessionId: string | null = null) {
    const now = new Date();
    testDb.db
      .insert(conversations)
      .values({
        id,
        title: "Test",
        sdkSessionId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  function seedReminder(convId: string): Reminder {
    const now = new Date();
    const id = "rem-1";
    testDb.db
      .insert(reminders)
      .values({
        id,
        name: "Test veille",
        message: "Research latest AI news",
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
      name: "Test veille",
      message: "Research latest AI news",
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

  async function loadModule() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("@/lib/memory", () => ({ readMemory: () => "test-memory" }));
    vi.doMock("@/lib/model-store", () => ({ getModel: () => "test-model" }));
    return import("@/lib/scheduled-agent");
  }

  function makeAgentStream(frames: unknown[]) {
    return vi.fn(async function* () {
      for (const f of frames) yield f;
    });
  }

  it("persists user prompt and assistant response, updates sdkSessionId", async () => {
    const convId = seedConversation();
    const reminder = seedReminder(convId);

    const stream = makeAgentStream([
      { type: "system", subtype: "init", session_id: "new-session-123" },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Here is the news summary." }],
        },
      },
      { type: "result", total_cost_usd: 0.0042, num_turns: 2 },
    ]);

    vi.doMock("@/lib/agent", () => ({
      startAgent: () => stream(),
    }));

    const { runScheduledAgent } = await loadModule();
    await runScheduledAgent(reminder);

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Research latest AI news");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("Here is the news summary.");

    const conv = testDb.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .get();
    expect(conv?.sdkSessionId).toBe("new-session-123");

    const reminderRow = testDb.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, reminder.id))
      .get();
    expect(reminderRow?.runningSince).toBeNull();
  });

  it("persists error message when agent throws", async () => {
    const convId = seedConversation();
    const reminder = seedReminder(convId);

    vi.doMock("@/lib/agent", () => ({
      startAgent: () => {
        throw new Error("SDK exploded");
      },
    }));

    const { runScheduledAgent } = await loadModule();
    await runScheduledAgent(reminder);

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toContain("⚠️ Veille failed");
    expect(msgs[1].content).toContain("SDK exploded");

    const reminderRow = testDb.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, reminder.id))
      .get();
    expect(reminderRow?.runningSince).toBeNull();
  });

  it("places a placeholder message when agent produces no output", async () => {
    const convId = seedConversation();
    const reminder = seedReminder(convId);

    const stream = makeAgentStream([
      { type: "system", subtype: "init", session_id: "s" },
      { type: "result", total_cost_usd: 0, num_turns: 0 },
    ]);
    vi.doMock("@/lib/agent", () => ({
      startAgent: () => stream(),
    }));

    const { runScheduledAgent } = await loadModule();
    await runScheduledAgent(reminder);

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toContain("no output");
  });

  it("passes the reminder conversation id into the agent context", async () => {
    const convId = seedConversation("conv-ctx");
    const reminder = seedReminder(convId);
    const startAgent = vi.fn().mockImplementation(
      () =>
        (async function* () {
          yield { type: "result", total_cost_usd: 0, num_turns: 0 };
        })(),
    );

    vi.doMock("@/lib/agent", () => ({
      startAgent,
    }));

    const { runScheduledAgent } = await loadModule();
    await runScheduledAgent(reminder);

    expect(startAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-ctx",
      }),
    );
  });
});
