export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
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

export type ExecutionKind = "reminder_notify" | "reminder_agent" | "dream";

export interface Execution {
  id: string;
  kind: ExecutionKind;
  sourceId: string | null;
  summary: string;
  conversationId: string | null;
  messageId: string | null;
  firedAt: string;
  readAt: string | null;
}

export interface Reminder {
  id: string;
  name: string;
  message: string;
  kind: "notify" | "agent";
  scheduleType: "once" | "recurring";
  cronExpr: string | null;
  scheduledAt: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  runningSince: string | null;
  timezone: string;
  conversationId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
