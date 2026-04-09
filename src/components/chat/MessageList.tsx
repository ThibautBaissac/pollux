"use client";

import { MessageBubble } from "./MessageBubble";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { Message } from "@/types";

export function MessageList({ messages }: { messages: Message[] }) {
  const { containerRef, bottomRef } = useAutoScroll([messages]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[50vh] items-center justify-center">
            <p className="text-text-muted">
              Send a message to start a conversation.
            </p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
