import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  sdkSessionId: text("sdk_session_id"),
  title: text("title").notNull().default("New conversation"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  toolUses: text("tool_uses"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const authConfig = sqliteTable("auth_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const recoveryCodes = sqliteTable("recovery_codes", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  used: integer("used").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  message: text("message").notNull(),
  scheduleType: text("schedule_type", { enum: ["once", "recurring"] })
    .notNull(),
  cronExpr: text("cron_expr"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp" }).notNull(),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  timezone: text("timezone").notNull().default("UTC"),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
