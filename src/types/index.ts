export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  toolUses: ToolUse[] | null;
  createdAt: string;
}

export interface ToolUse {
  name: string;
  input?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export type StreamStatus = "idle" | "loading" | "streaming" | "error";

export interface Reminder {
  id: string;
  name: string;
  message: string;
  scheduleType: "once" | "recurring";
  cronExpr: string | null;
  scheduledAt: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  timezone: string;
  conversationId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
