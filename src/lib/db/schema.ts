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
