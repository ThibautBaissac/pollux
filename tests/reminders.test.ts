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
