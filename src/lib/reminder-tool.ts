import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createReminder,
  deleteReminder,
  formatSchedule,
  listReminders,
  updateReminder,
} from "@/lib/reminders";

export const REMINDER_MCP_SERVER_NAME = "pollux-reminders";
export const REMINDER_MCP_TOOL_NAME = "reminder";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError && { isError }) };
}

const reminderTool = tool(
  REMINDER_MCP_TOOL_NAME,
  `Create, list, edit, or delete scheduled reminders.

Actions:
- add: Schedule a new reminder. Requires name, message, and either cronExpr (recurring) or scheduledAt (one-time).
  - kind (optional): "notify" (default) posts the message as a static reminder; "agent" executes the message as a prompt in the linked conversation at each run (use for automated monitoring / veille)
  - cronExpr uses standard 5-field cron syntax: minute hour day-of-month month day-of-week
  - Common patterns: "0 15 * * 5" = every Friday 3 PM, "30 9 * * 1-5" = weekdays 9:30 AM, "0 0 1 * *" = 1st of month midnight
  - scheduledAt is an ISO 8601 datetime string for one-time reminders
  - timezone is an IANA timezone string (e.g. "America/New_York", "Europe/Paris"). Default: UTC
- edit: Update an existing reminder by reminderId. Any editable field may be provided: name, message, kind, scheduleType, cronExpr, scheduledAt, timezone, conversationId, enabled.
  - When switching scheduleType, provide the matching schedule field: cronExpr for recurring, scheduledAt for once
- list: Show all reminders with their status and next run time
- remove: Delete a reminder by ID`,
  {
    action: z.enum(["add", "list", "edit", "remove"]),
    name: z.string().optional().describe("Human-readable label for the reminder"),
    message: z.string().optional().describe("Text posted (notify) or prompt executed (agent) when the reminder fires"),
    kind: z.enum(["notify", "agent"]).optional().describe("notify (default) posts a static message; agent runs the message as a prompt for automated monitoring"),
    scheduleType: z.enum(["once", "recurring"]).optional(),
    cronExpr: z.string().optional().describe("5-field cron expression (for recurring reminders)"),
    scheduledAt: z.string().optional().describe("ISO 8601 datetime (for one-time reminders)"),
    timezone: z.string().optional().describe("IANA timezone, e.g. America/New_York"),
    conversationId: z.string().optional().describe("Conversation to deliver the reminder to"),
    reminderId: z.string().optional().describe("Reminder ID (for edit or remove action)"),
    enabled: z.boolean().optional().describe("Whether the reminder is active"),
  },
  async (args) => {
    try {
      if (args.action === "list") {
        const all = listReminders();
        if (all.length === 0) return textResult("No reminders scheduled.");
        const lines = all.map((r) => {
          const status = r.enabled ? "active" : "disabled";
          const lastRun = r.lastRunAt ? `last: ${r.lastRunAt}` : "never run";
          return `- ${r.name} (id: ${r.id}, ${formatSchedule(r)}, ${status})\n  Next: ${r.nextRunAt} | ${lastRun}`;
        });
        return textResult(lines.join("\n"));
      }

      if (args.action === "remove") {
        if (!args.reminderId) return textResult("Error: reminderId is required for remove action.", true);
        const deleted = deleteReminder(args.reminderId);
        return deleted ? textResult("Reminder deleted.") : textResult("Reminder not found.", true);
      }

      if (args.action === "edit") {
        if (!args.reminderId) {
          return textResult(
            "Error: reminderId is required for edit action.",
            true,
          );
        }

        const fields = {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.message !== undefined ? { message: args.message } : {}),
          ...(args.kind !== undefined ? { kind: args.kind } : {}),
          ...(args.scheduleType !== undefined
            ? { scheduleType: args.scheduleType }
            : {}),
          ...(args.cronExpr !== undefined ? { cronExpr: args.cronExpr } : {}),
          ...(args.scheduledAt !== undefined
            ? { scheduledAt: args.scheduledAt }
            : {}),
          ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
          ...(args.conversationId !== undefined
            ? { conversationId: args.conversationId }
            : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        };

        if (Object.keys(fields).length === 0) {
          return textResult(
            "Error: at least one editable field is required for edit action.",
            true,
          );
        }

        const reminder = updateReminder(args.reminderId, fields);
        if (!reminder) return textResult("Reminder not found.", true);

        const status = reminder.enabled ? "active" : "disabled";
        return textResult(
          `Reminder "${reminder.name}" updated (id: ${reminder.id}).\nSchedule: ${formatSchedule(reminder)}\nStatus: ${status}\nNext run: ${reminder.nextRunAt}`,
        );
      }

      if (!args.name || !args.message || !args.scheduleType || !args.conversationId) {
        return textResult("Error: name, message, scheduleType, and conversationId are required for add.", true);
      }

      const reminder = createReminder({
        name: args.name,
        message: args.message,
        kind: args.kind,
        scheduleType: args.scheduleType,
        cronExpr: args.cronExpr,
        scheduledAt: args.scheduledAt,
        timezone: args.timezone,
        conversationId: args.conversationId,
      });

      return textResult(
        `Reminder "${reminder.name}" created (id: ${reminder.id}).\nSchedule: ${formatSchedule(reminder)}\nNext run: ${reminder.nextRunAt}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Error: ${msg}`, true);
    }
  },
);

export const reminderMcpServer = createSdkMcpServer({
  name: REMINDER_MCP_SERVER_NAME,
  tools: [reminderTool],
});
