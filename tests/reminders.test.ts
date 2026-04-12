import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { conversations, messages, reminders } from "@/lib/db/schema";
import { createTestDb, type TestDbContext } from "./helpers/test-db";

describe("reminders", () => {
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

  async function loadModule() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    // Stub the runner: tests in this file assert on DB side effects, not agent execution.
    vi.doMock("@/lib/scheduled-agent", () => ({
      runScheduledAgent: vi.fn(async () => {}),
    }));
    return import("@/lib/reminders");
  }

  // --- validateCronExpr ---

  it("returns null for valid cron expressions", async () => {
    const { validateCronExpr } = await loadModule();
    expect(validateCronExpr("0 15 * * 5")).toBeNull();
    expect(validateCronExpr("*/5 * * * *")).toBeNull();
    expect(validateCronExpr("30 9 * * 1-5")).toBeNull();
  });

  it("returns error for invalid cron expressions", async () => {
    const { validateCronExpr } = await loadModule();
    expect(validateCronExpr("not a cron")).toBe("Invalid cron expression");
    expect(validateCronExpr("")).toBe("Invalid cron expression");
    expect(validateCronExpr("70 * * * *")).toBe("Invalid cron expression");
  });

  // --- createReminder ---

  it("creates a recurring reminder", async () => {
    const { createReminder } = await loadModule();
    const convId = seedConversation();

    const r = createReminder({
      name: "Weekly review",
      message: "Time to review PRs",
      scheduleType: "recurring",
      cronExpr: "0 15 * * 5",
      timezone: "UTC",
      conversationId: convId,
    });

    expect(r.id).toBeTruthy();
    expect(r.name).toBe("Weekly review");
    expect(r.scheduleType).toBe("recurring");
    expect(r.cronExpr).toBe("0 15 * * 5");
    expect(r.enabled).toBe(true);
    expect(r.nextRunAt).toBeTruthy();
  });

  it("creates a one-time reminder", async () => {
    const { createReminder } = await loadModule();
    const convId = seedConversation();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const r = createReminder({
      name: "One-off",
      message: "Do the thing",
      scheduleType: "once",
      scheduledAt: future,
      conversationId: convId,
    });

    expect(r.scheduleType).toBe("once");
    // SQLite integer timestamps store seconds, so compare at second precision
    const storedSec = Math.floor(new Date(r.scheduledAt!).getTime() / 1000);
    const expectedSec = Math.floor(new Date(future).getTime() / 1000);
    expect(storedSec).toBe(expectedSec);
  });

  it("throws if cronExpr missing for recurring", async () => {
    const { createReminder } = await loadModule();
    const convId = seedConversation();

    expect(() =>
      createReminder({
        name: "Bad",
        message: "x",
        scheduleType: "recurring",
        conversationId: convId,
      }),
    ).toThrow("cronExpr required");
  });

  it("throws if scheduledAt missing for once", async () => {
    const { createReminder } = await loadModule();
    const convId = seedConversation();

    expect(() =>
      createReminder({
        name: "Bad",
        message: "x",
        scheduleType: "once",
        conversationId: convId,
      }),
    ).toThrow("scheduledAt required");
  });

  it("throws for invalid cron expression", async () => {
    const { createReminder } = await loadModule();
    const convId = seedConversation();

    expect(() =>
      createReminder({
        name: "Bad",
        message: "x",
        scheduleType: "recurring",
        cronExpr: "not valid",
        conversationId: convId,
      }),
    ).toThrow("Invalid cron expression");
  });

  // --- listReminders / getReminder ---

  it("lists and retrieves reminders", async () => {
    const { createReminder, listReminders, getReminder } = await loadModule();
    const convId = seedConversation();

    const r = createReminder({
      name: "Test",
      message: "msg",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      conversationId: convId,
    });

    const all = listReminders();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(r.id);

    const single = getReminder(r.id);
    expect(single).not.toBeNull();
    expect(single!.name).toBe("Test");
  });

  it("returns null for non-existent reminder", async () => {
    const { getReminder } = await loadModule();
    expect(getReminder("nonexistent")).toBeNull();
  });

  // --- updateReminder ---

  it("updates reminder fields", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();

    const r = createReminder({
      name: "Old name",
      message: "old",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      conversationId: convId,
    });

    const updated = updateReminder(r.id, { name: "New name", enabled: false });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New name");
    expect(updated!.enabled).toBe(false);
  });

  it("recomputes a recurring schedule when cron or timezone changes", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();

    const r = createReminder({
      name: "Morning brief",
      message: "Check updates",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      timezone: "UTC",
      conversationId: convId,
    });

    const updated = updateReminder(r.id, {
      cronExpr: "30 14 * * 1",
      timezone: "Europe/Paris",
    });

    expect(updated).not.toBeNull();
    expect(updated!.scheduleType).toBe("recurring");
    expect(updated!.cronExpr).toBe("30 14 * * 1");
    expect(updated!.scheduledAt).toBeNull();
    expect(updated!.timezone).toBe("Europe/Paris");
    expect(updated!.nextRunAt).not.toBe(r.nextRunAt);
  });

  it("switches a recurring reminder to a one-time reminder", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();
    const scheduledAt = new Date(Date.now() + 172_800_000).toISOString();

    const r = createReminder({
      name: "Weekly sync",
      message: "Prepare notes",
      scheduleType: "recurring",
      cronExpr: "0 9 * * 1",
      conversationId: convId,
    });

    const updated = updateReminder(r.id, {
      scheduleType: "once",
      scheduledAt,
    });

    expect(updated).not.toBeNull();
    expect(updated!.scheduleType).toBe("once");
    expect(updated!.cronExpr).toBeNull();
    expect(updated!.scheduledAt).not.toBeNull();

    const updatedSec = Math.floor(new Date(updated!.scheduledAt!).getTime() / 1000);
    const expectedSec = Math.floor(new Date(scheduledAt).getTime() / 1000);
    const nextRunSec = Math.floor(new Date(updated!.nextRunAt).getTime() / 1000);
    expect(updatedSec).toBe(expectedSec);
    expect(nextRunSec).toBe(expectedSec);
  });

  it("switches a one-time reminder to a recurring reminder", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();
    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();

    const r = createReminder({
      name: "One-off check-in",
      message: "Ping me later",
      scheduleType: "once",
      scheduledAt,
      conversationId: convId,
    });

    const updated = updateReminder(r.id, {
      scheduleType: "recurring",
      cronExpr: "0 8 * * 1-5",
      timezone: "Europe/Paris",
    });

    expect(updated).not.toBeNull();
    expect(updated!.scheduleType).toBe("recurring");
    expect(updated!.cronExpr).toBe("0 8 * * 1-5");
    expect(updated!.scheduledAt).toBeNull();
    expect(updated!.timezone).toBe("Europe/Paris");
    expect(updated!.nextRunAt).not.toBe(r.nextRunAt);
  });

  it("updates reminder kind and destination conversation", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();
    const otherConvId = seedConversation("conv-2");

    const r = createReminder({
      name: "Status report",
      message: "Summarize today",
      scheduleType: "recurring",
      cronExpr: "0 18 * * *",
      conversationId: convId,
    });

    const updated = updateReminder(r.id, {
      kind: "agent",
      conversationId: otherConvId,
    });

    expect(updated).not.toBeNull();
    expect(updated!.kind).toBe("agent");
    expect(updated!.conversationId).toBe(otherConvId);
  });

  it("throws for invalid cron expression on update", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();

    const r = createReminder({
      name: "Bad cron",
      message: "Oops",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      conversationId: convId,
    });

    expect(() => updateReminder(r.id, { cronExpr: "not valid" })).toThrow(
      "Invalid cron expression",
    );
  });

  it("throws for invalid scheduledAt on update", async () => {
    const { createReminder, updateReminder } = await loadModule();
    const convId = seedConversation();
    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();

    const r = createReminder({
      name: "Bad date",
      message: "Oops",
      scheduleType: "once",
      scheduledAt,
      conversationId: convId,
    });

    expect(() => updateReminder(r.id, { scheduledAt: "not-a-date" })).toThrow(
      "Invalid scheduledAt",
    );
  });

  it("returns null when updating non-existent reminder", async () => {
    const { updateReminder } = await loadModule();
    expect(updateReminder("nonexistent", { name: "x" })).toBeNull();
  });

  // --- deleteReminder ---

  it("deletes a reminder", async () => {
    const { createReminder, deleteReminder, listReminders } =
      await loadModule();
    const convId = seedConversation();

    const r = createReminder({
      name: "Delete me",
      message: "bye",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      conversationId: convId,
    });

    expect(deleteReminder(r.id)).toBe(true);
    expect(listReminders()).toHaveLength(0);
  });

  it("returns false for deleting non-existent reminder", async () => {
    const { deleteReminder } = await loadModule();
    expect(deleteReminder("nonexistent")).toBe(false);
  });

  // --- checkDueReminders ---

  it("fires a due one-time reminder and disables it", async () => {
    const { createReminder, checkDueReminders, getReminder } =
      await loadModule();
    const convId = seedConversation();

    // Create a reminder with scheduledAt in the past
    const past = new Date(Date.now() - 60_000).toISOString();
    const r = createReminder({
      name: "Past reminder",
      message: "You forgot this",
      scheduleType: "once",
      scheduledAt: past,
      conversationId: convId,
    });

    checkDueReminders();

    // Should have inserted a message
    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("You forgot this");
    expect(msgs[0].role).toBe("assistant");

    // Should be disabled
    const updated = getReminder(r.id);
    expect(updated!.enabled).toBe(false);
    expect(updated!.lastRunAt).not.toBeNull();
  });

  it("fires a due recurring reminder and computes next run", async () => {
    const { checkDueReminders, getReminder } = await loadModule();
    const convId = seedConversation();

    // Insert directly with nextRunAt in the past
    const pastTime = new Date(Date.now() - 60_000);
    testDb.db
      .insert(reminders)
      .values({
        id: "recurring-1",
        name: "Daily standup",
        message: "Time for standup",
        scheduleType: "recurring",
        cronExpr: "0 9 * * *",
        nextRunAt: pastTime,
        timezone: "UTC",
        conversationId: convId,
        createdAt: pastTime,
        updatedAt: pastTime,
      })
      .run();

    checkDueReminders();

    const updated = getReminder("recurring-1");
    expect(updated!.enabled).toBe(true);
    expect(updated!.lastRunAt).not.toBeNull();
    // Next run should be in the future
    expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Time for standup");
  });

  it("does not fire disabled reminders", async () => {
    const { createReminder, updateReminder, checkDueReminders } =
      await loadModule();
    const convId = seedConversation();

    const past = new Date(Date.now() - 60_000).toISOString();
    const r = createReminder({
      name: "Disabled",
      message: "Should not fire",
      scheduleType: "once",
      scheduledAt: past,
      conversationId: convId,
    });
    updateReminder(r.id, { enabled: false });

    checkDueReminders();

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(0);
  });

  it("does not fire future reminders", async () => {
    const { createReminder, checkDueReminders } = await loadModule();
    const convId = seedConversation();

    const future = new Date(Date.now() + 86_400_000).toISOString();
    createReminder({
      name: "Future",
      message: "Not yet",
      scheduleType: "once",
      scheduledAt: future,
      conversationId: convId,
    });

    checkDueReminders();

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs).toHaveLength(0);
  });

  // --- kind routing ---

  it("does not insert a static message for kind='agent' reminders", async () => {
    const { createReminder, checkDueReminders, getReminder } =
      await loadModule();
    const convId = seedConversation();

    const past = new Date(Date.now() - 60_000).toISOString();
    const r = createReminder({
      name: "Veille",
      message: "Research AI news",
      kind: "agent",
      scheduleType: "once",
      scheduledAt: past,
      conversationId: convId,
    });

    checkDueReminders();

    const msgs = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();
    expect(msgs.filter((m) => m.content.startsWith("⏰"))).toHaveLength(0);

    const updated = getReminder(r.id);
    expect(updated!.runningSince).not.toBeNull();
    expect(updated!.lastRunAt).not.toBeNull();
  });

  it("delegates kind='agent' reminders to runScheduledAgent", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    const spy = vi.fn(async () => {});
    vi.doMock("@/lib/scheduled-agent", () => ({
      runScheduledAgent: spy,
    }));
    const { createReminder, checkDueReminders } = await import(
      "@/lib/reminders"
    );

    const convId = seedConversation();
    const past = new Date(Date.now() - 60_000).toISOString();
    createReminder({
      name: "Veille",
      message: "Do research",
      kind: "agent",
      scheduleType: "once",
      scheduledAt: past,
      conversationId: convId,
    });

    checkDueReminders();

    // Microtask flush so the dynamic import + Promise.allSettled run.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(spy).toHaveBeenCalledTimes(1);
    const firstCall = spy.mock.calls[0] as unknown as [{ kind: string }];
    expect(firstCall[0].kind).toBe("agent");
  });

  // --- runningSince lock ---

  it("clears stale runningSince (older than 10 min) on next tick", async () => {
    const { checkDueReminders, getReminder } = await loadModule();
    const convId = seedConversation();

    const staleTime = new Date(Date.now() - 11 * 60 * 1000);
    const past = new Date(Date.now() - 60_000);
    testDb.db
      .insert(reminders)
      .values({
        id: "stale-1",
        name: "Stale veille",
        message: "x",
        kind: "agent",
        scheduleType: "recurring",
        cronExpr: "* * * * *",
        nextRunAt: past,
        runningSince: staleTime,
        timezone: "UTC",
        conversationId: convId,
        createdAt: staleTime,
        updatedAt: staleTime,
      })
      .run();

    checkDueReminders();

    const updated = getReminder("stale-1");
    expect(updated!.runningSince).not.toBeNull();
    const runningTs = new Date(updated!.runningSince!).getTime();
    expect(runningTs).toBeGreaterThan(staleTime.getTime());
  });

  it("skips agent reminder when another is already running on same conversation", async () => {
    const { checkDueReminders, getReminder } = await loadModule();
    const convId = seedConversation();

    const past = new Date(Date.now() - 60_000);
    const earlier = new Date(Date.now() - 30_000);
    testDb.db
      .insert(reminders)
      .values({
        id: "busy-1",
        name: "Busy",
        message: "x",
        kind: "agent",
        scheduleType: "recurring",
        cronExpr: "* * * * *",
        nextRunAt: new Date(Date.now() + 60_000),
        runningSince: earlier,
        timezone: "UTC",
        conversationId: convId,
        createdAt: earlier,
        updatedAt: earlier,
      })
      .run();
    testDb.db
      .insert(reminders)
      .values({
        id: "queued-1",
        name: "Queued",
        message: "y",
        kind: "agent",
        scheduleType: "recurring",
        cronExpr: "* * * * *",
        nextRunAt: past,
        timezone: "UTC",
        conversationId: convId,
        createdAt: past,
        updatedAt: past,
      })
      .run();

    checkDueReminders();

    const queued = getReminder("queued-1");
    expect(queued!.runningSince).toBeNull();
  });

  // --- cascade delete ---

  it("deletes reminders when conversation is deleted", async () => {
    const { createReminder, listReminders } = await loadModule();
    const convId = seedConversation();

    createReminder({
      name: "Cascade test",
      message: "bye",
      scheduleType: "recurring",
      cronExpr: "0 9 * * *",
      conversationId: convId,
    });
    expect(listReminders()).toHaveLength(1);

    testDb.db
      .delete(conversations)
      .where(eq(conversations.id, convId))
      .run();

    expect(listReminders()).toHaveLength(0);
  });
});
