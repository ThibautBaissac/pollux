"use client";

import { createContext, useContext } from "react";
import { useChat, type UseChatReturn } from "@/hooks/useChat";

const ChatStreamContext = createContext<UseChatReturn | null>(null);

export function ChatStreamProvider({
  children,
  onConversationCreated,
}: {
  children: React.ReactNode;
  onConversationCreated?: () => void;
}) {
  const chat = useChat({ onConversationCreated });
  return (
    <ChatStreamContext.Provider value={chat}>
      {children}
    </ChatStreamContext.Provider>
  );
}

export function useChatStream(): UseChatReturn {
  const ctx = useContext(ChatStreamContext);
  if (!ctx) {
    throw new Error("useChatStream must be used within ChatStreamProvider");
  }
  return ctx;
}
