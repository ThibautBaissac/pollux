import { db } from "@/lib/db";
import { conversations, messages, reminders } from "@/lib/db/schema";
import { eq, and, lte, asc } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import type { Reminder } from "@/types";

function computeNextRun(cronExpr: string, timezone: string): Date {
  const expr = CronExpressionParser.parse(cronExpr, { tz: timezone });
  return expr.next().toDate();
}

function toApiReminder(row: typeof reminders.$inferSelect): Reminder {
  return {
    id: row.id,
    name: row.name,
    message: row.message,
    scheduleType: row.scheduleType,
    cronExpr: row.cronExpr,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    timezone: row.timezone,
    conversationId: row.conversationId,
    enabled: row.enabled === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function formatSchedule(r: Reminder): string {
  if (r.scheduleType === "recurring") {
    return `cron: ${r.cronExpr} (${r.timezone})`;
  }
  return `once: ${r.scheduledAt}`;
}

export function validateCronExpr(expr: string): string | null {
  if (!expr.trim()) return "Invalid cron expression";
  try {
    CronExpressionParser.parse(expr);
    return null;
  } catch {
    return "Invalid cron expression";
  }
}

export function listReminders(): Reminder[] {
  const rows = db
    .select()
    .from(reminders)
    .orderBy(asc(reminders.nextRunAt))
    .all();
  return rows.map(toApiReminder);
}

export function getReminder(id: string): Reminder | null {
  const row = db.select().from(reminders).where(eq(reminders.id, id)).get();
  return row ? toApiReminder(row) : null;
}

export function createReminder(params: {
  name: string;
  message: string;
  scheduleType: "once" | "recurring";
  cronExpr?: string;
  scheduledAt?: string;
  timezone?: string;
  conversationId: string;
}): Reminder {
  const tz = params.timezone ?? "UTC";
  const now = new Date();

  let nextRunAt: Date;
  let cronExpr: string | null = null;
  let scheduledAt: Date | null = null;

  if (params.scheduleType === "recurring") {
    if (!params.cronExpr) throw new Error("cronExpr required for recurring");
    const err = validateCronExpr(params.cronExpr);
    if (err) throw new Error(err);
    cronExpr = params.cronExpr;
    nextRunAt = computeNextRun(cronExpr, tz);
  } else {
    if (!params.scheduledAt) throw new Error("scheduledAt required for once");
    scheduledAt = new Date(params.scheduledAt);
    if (isNaN(scheduledAt.getTime())) throw new Error("Invalid scheduledAt");
    nextRunAt = scheduledAt;
  }

  const id = crypto.randomUUID();

  db.insert(reminders)
    .values({
      id,
      name: params.name,
      message: params.message,
      scheduleType: params.scheduleType,
      cronExpr,
      scheduledAt,
      nextRunAt,
      timezone: tz,
      conversationId: params.conversationId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return toApiReminder({
    id,
    name: params.name,
    message: params.message,
    scheduleType: params.scheduleType,
    cronExpr,
    scheduledAt,
    nextRunAt,
    lastRunAt: null,
    timezone: tz,
    conversationId: params.conversationId,
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateReminder(
  id: string,
  fields: { name?: string; message?: string; enabled?: boolean },
): Reminder | null {
  const now = new Date();
  const updates: Partial<typeof reminders.$inferInsert> = { updatedAt: now };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.message !== undefined) updates.message = fields.message;
  if (fields.enabled !== undefined) updates.enabled = fields.enabled ? 1 : 0;

  const { changes } = db
    .update(reminders)
    .set(updates)
    .where(eq(reminders.id, id))
    .run();
  if (changes === 0) return null;

  return getReminder(id);
}

export function deleteReminder(id: string): boolean {
  const { changes } = db
    .delete(reminders)
    .where(eq(reminders.id, id))
    .run();
  return changes > 0;
}

export function checkDueReminders(): void {
  const now = new Date();
  const due = db
    .select()
    .from(reminders)
    .where(and(eq(reminders.enabled, 1), lte(reminders.nextRunAt, now)))
    .all();

  if (due.length === 0) return;

  db.transaction((tx) => {
    for (const reminder of due) {
      tx.insert(messages)
        .values({
          id: crypto.randomUUID(),
          conversationId: reminder.conversationId,
          role: "assistant",
          content: `⏰ **Reminder:** ${reminder.message}`,
          createdAt: now,
        })
        .run();

      tx.update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, reminder.conversationId))
        .run();

      if (reminder.scheduleType === "recurring" && reminder.cronExpr) {
        const nextRun = computeNextRun(reminder.cronExpr, reminder.timezone);
        tx.update(reminders)
          .set({ nextRunAt: nextRun, lastRunAt: now, updatedAt: now })
          .where(eq(reminders.id, reminder.id))
          .run();
      } else {
        // One-time: disable after firing
        tx.update(reminders)
          .set({ enabled: 0, lastRunAt: now, updatedAt: now })
          .where(eq(reminders.id, reminder.id))
          .run();
      }
    }
  });
}
