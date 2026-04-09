"use client";

import { MessageBubble } from "./MessageBubble";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { Message } from "@/types";

export function MessageList({
  messages,
  loading,
}: {
  messages: Message[];
  loading?: boolean;
}) {
  const { containerRef, bottomRef } = useAutoScroll([messages]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {loading ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <div className="h-8 w-48 animate-pulse rounded-lg bg-bg-tertiary" />
            </div>
            <div className="flex justify-start">
              <div className="space-y-2">
                <div className="h-4 w-72 animate-pulse rounded bg-bg-tertiary" />
                <div className="h-4 w-56 animate-pulse rounded bg-bg-tertiary" />
                <div className="h-4 w-64 animate-pulse rounded bg-bg-tertiary" />
              </div>
            </div>
            <div className="flex justify-end">
              <div className="h-8 w-36 animate-pulse rounded-lg bg-bg-tertiary" />
            </div>
            <div className="flex justify-start">
              <div className="space-y-2">
                <div className="h-4 w-64 animate-pulse rounded bg-bg-tertiary" />
                <div className="h-4 w-48 animate-pulse rounded bg-bg-tertiary" />
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3">
            <div className="rounded-full bg-bg-secondary p-4">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-text-muted"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
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
