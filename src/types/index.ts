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
