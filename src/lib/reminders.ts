import { db } from "@/lib/db";
import {
  conversations,
  executions,
  messages,
  reminders,
} from "@/lib/db/schema";
import { eq, and, lte, asc, isNull, lt, sql, inArray } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { trimExecutions } from "@/lib/executions";
import type { Reminder } from "@/types";

const STALE_RUN_MS = 10 * 60 * 1000;

function computeNextRun(cronExpr: string, timezone: string): Date {
  const expr = CronExpressionParser.parse(cronExpr, { tz: timezone });
  return expr.next().toDate();
}

function toApiReminder(row: typeof reminders.$inferSelect): Reminder {
  return {
    id: row.id,
    name: row.name,
    message: row.message,
    kind: row.kind,
    scheduleType: row.scheduleType,
    cronExpr: row.cronExpr,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    runningSince: row.runningSince?.toISOString() ?? null,
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

export const REMINDER_VALIDATION_ERRORS = {
  invalidCron: "Invalid cron expression",
  invalidScheduledAt: "Invalid scheduledAt",
  invalidTimezone: "Invalid timezone",
  cronRequired: "cronExpr required for recurring",
  scheduledAtRequired: "scheduledAt required for once",
} as const;

export const SAFE_REMINDER_ERRORS: readonly string[] = Object.values(
  REMINDER_VALIDATION_ERRORS,
);

export function validateCronExpr(expr: string): string | null {
  if (!expr.trim()) return REMINDER_VALIDATION_ERRORS.invalidCron;
  try {
    CronExpressionParser.parse(expr);
    return null;
  } catch {
    return REMINDER_VALIDATION_ERRORS.invalidCron;
  }
}

export function validateTimezone(timezone: string): string | null {
  if (!timezone.trim()) return REMINDER_VALIDATION_ERRORS.invalidTimezone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return null;
  } catch {
    return REMINDER_VALIDATION_ERRORS.invalidTimezone;
  }
}

export interface ReminderCreateParams {
  name: string;
  message: string;
  kind?: "notify" | "agent";
  scheduleType: "once" | "recurring";
  cronExpr?: string;
  scheduledAt?: string;
  timezone?: string;
  conversationId: string;
}

export interface ReminderUpdateFields {
  name?: string;
  message?: string;
  kind?: "notify" | "agent";
  scheduleType?: "once" | "recurring";
  cronExpr?: string;
  scheduledAt?: string;
  timezone?: string;
  conversationId?: string;
  enabled?: boolean;
}

function parseScheduledAt(value: string): Date {
  const scheduledAt = new Date(value);
  if (isNaN(scheduledAt.getTime())) {
    throw new Error(REMINDER_VALIDATION_ERRORS.invalidScheduledAt);
  }
  return scheduledAt;
}

function resolveReminderSchedule(params: {
  scheduleType: "once" | "recurring";
  cronExpr?: string | null;
  scheduledAt?: string | null;
  timezone?: string;
}) {
  const timezone = (params.timezone ?? "UTC").trim();
  const timezoneError = validateTimezone(timezone);
  if (timezoneError) throw new Error(timezoneError);

  if (params.scheduleType === "recurring") {
    const cronExpr = params.cronExpr?.trim();
    if (!cronExpr) {
      throw new Error(REMINDER_VALIDATION_ERRORS.cronRequired);
    }
    const cronError = validateCronExpr(cronExpr);
    if (cronError) throw new Error(cronError);

    return {
      cronExpr,
      scheduledAt: null,
      nextRunAt: computeNextRun(cronExpr, timezone),
      timezone,
    };
  }

  const scheduledAtValue = params.scheduledAt?.trim();
  if (!scheduledAtValue) {
    throw new Error(REMINDER_VALIDATION_ERRORS.scheduledAtRequired);
  }

  const scheduledAt = parseScheduledAt(scheduledAtValue);
  return {
    cronExpr: null,
    scheduledAt,
    nextRunAt: scheduledAt,
    timezone,
  };
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

export function createReminder(params: ReminderCreateParams): Reminder {
  const kind = params.kind ?? "notify";
  const now = new Date();
  const { cronExpr, scheduledAt, nextRunAt, timezone } =
    resolveReminderSchedule({
      scheduleType: params.scheduleType,
      cronExpr: params.cronExpr,
      scheduledAt: params.scheduledAt,
      timezone: params.timezone,
    });

  const id = crypto.randomUUID();

  db.insert(reminders)
    .values({
      id,
      name: params.name,
      message: params.message,
      kind,
      scheduleType: params.scheduleType,
      cronExpr,
      scheduledAt,
      nextRunAt,
      timezone,
      conversationId: params.conversationId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return toApiReminder({
    id,
    name: params.name,
    message: params.message,
    kind,
    scheduleType: params.scheduleType,
    cronExpr,
    scheduledAt,
    nextRunAt,
    lastRunAt: null,
    runningSince: null,
    timezone,
    conversationId: params.conversationId,
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateReminder(id: string, fields: ReminderUpdateFields): Reminder | null {
  const existing = db.select().from(reminders).where(eq(reminders.id, id)).get();
  if (!existing) return null;

  const now = new Date();
  const updates: Partial<typeof reminders.$inferInsert> = { updatedAt: now };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.message !== undefined) updates.message = fields.message;
  if (fields.kind !== undefined) updates.kind = fields.kind;
  if (fields.conversationId !== undefined) updates.conversationId = fields.conversationId;
  if (fields.enabled !== undefined) updates.enabled = fields.enabled ? 1 : 0;

  if (
    fields.scheduleType !== undefined ||
    fields.cronExpr !== undefined ||
    fields.scheduledAt !== undefined ||
    fields.timezone !== undefined
  ) {
    const resolved = resolveReminderSchedule({
      scheduleType: fields.scheduleType ?? existing.scheduleType,
      cronExpr: fields.cronExpr ?? existing.cronExpr,
      scheduledAt:
        fields.scheduledAt ?? existing.scheduledAt?.toISOString() ?? null,
      timezone: fields.timezone ?? existing.timezone,
    });

    updates.scheduleType = fields.scheduleType ?? existing.scheduleType;
    updates.cronExpr = resolved.cronExpr;
    updates.scheduledAt = resolved.scheduledAt;
    updates.nextRunAt = resolved.nextRunAt;
    updates.timezone = resolved.timezone;
  }

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

export function clearRunningFlag(id: string): void {
  db.update(reminders)
    .set({ runningSince: null, updatedAt: new Date() })
    .where(eq(reminders.id, id))
    .run();
}

export function checkDueReminders(): void {
  const now = new Date();

  // Recover from crashes: release stale run locks.
  const staleCutoff = new Date(now.getTime() - STALE_RUN_MS);
  db.update(reminders)
    .set({ runningSince: null })
    .where(
      and(
        sql`${reminders.runningSince} IS NOT NULL`,
        lt(reminders.runningSince, staleCutoff),
      ),
    )
    .run();

  const due = db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.enabled, 1),
        lte(reminders.nextRunAt, now),
        isNull(reminders.runningSince),
      ),
    )
    .all();

  if (due.length === 0) return;

  // Conversations that already have a running veille — we can't enqueue a
  // second one because they would corrupt the shared SDK session.
  const dueConvIds = Array.from(new Set(due.map((r) => r.conversationId)));
  const busyConvs = new Set<string>(
    db
      .select({ conversationId: reminders.conversationId })
      .from(reminders)
      .where(
        and(
          eq(reminders.kind, "agent"),
          sql`${reminders.runningSince} IS NOT NULL`,
          inArray(reminders.conversationId, dueConvIds),
        ),
      )
      .all()
      .map((r) => r.conversationId),
  );

  const agentRuns: typeof due = [];
  let notifyFired = false;

  db.transaction((tx) => {
    for (const reminder of due) {
      if (reminder.kind === "agent") {
        if (busyConvs.has(reminder.conversationId)) {
          // Leave nextRunAt untouched so the next tick retries.
          continue;
        }
        busyConvs.add(reminder.conversationId);

        tx.update(reminders)
          .set({
            runningSince: now,
            lastRunAt: now,
            updatedAt: now,
            ...(reminder.scheduleType === "recurring" && reminder.cronExpr
              ? {
                  nextRunAt: computeNextRun(
                    reminder.cronExpr,
                    reminder.timezone,
                  ),
                }
              : { enabled: 0 }),
          })
          .where(eq(reminders.id, reminder.id))
          .run();

        agentRuns.push(reminder);
        continue;
      }

      const messageId = crypto.randomUUID();
      tx.insert(messages)
        .values({
          id: messageId,
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

      tx.insert(executions)
        .values({
          id: crypto.randomUUID(),
          kind: "reminder_notify",
          sourceId: reminder.id,
          summary: reminder.name,
          conversationId: reminder.conversationId,
          messageId,
          firedAt: now,
          readAt: null,
        })
        .run();
      notifyFired = true;

      if (reminder.scheduleType === "recurring" && reminder.cronExpr) {
        const nextRun = computeNextRun(reminder.cronExpr, reminder.timezone);
        tx.update(reminders)
          .set({ nextRunAt: nextRun, lastRunAt: now, updatedAt: now })
          .where(eq(reminders.id, reminder.id))
          .run();
      } else {
        tx.update(reminders)
          .set({ enabled: 0, lastRunAt: now, updatedAt: now })
          .where(eq(reminders.id, reminder.id))
          .run();
      }
    }
  });

  if (notifyFired) trimExecutions();

  // IMPORTANT: agent runs kick off AFTER the transaction commits.
  // Never await or call runScheduledAgent inside the tx callback —
  // better-sqlite3 transactions are synchronous; async work would
  // hold the transaction open or fire before commit.
  if (agentRuns.length > 0) {
    void (async () => {
      const { runScheduledAgent } = await import("@/lib/scheduled-agent");
      await Promise.allSettled(
        agentRuns.map((r) => runScheduledAgent(toApiReminder(r))),
      );
    })();
  }
}
