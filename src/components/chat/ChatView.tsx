"use client";

import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChatStream } from "./ChatStreamProvider";

export function ChatView() {
  const { messages, error } = useChatStream();

  return (
    <div className="flex h-screen flex-col">
      {error && (
        <div className="border-b border-border bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {error}
        </div>
      )}
      <MessageList messages={messages} />
      <ChatInput />
    </div>
  );
}
