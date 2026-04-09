"use client";

import Link from "next/link";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChatStream } from "./ChatStreamProvider";

export function ChatView() {
  const { messages, error } = useChatStream();

  return (
    <div className="flex h-full flex-col">
      {/* Mobile header — hidden on desktop */}
      <div className="flex items-center gap-2 border-b border-border p-3 md:hidden">
        <Link
          href="/chat"
          className="text-text-secondary hover:text-text-primary"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <span className="text-sm font-medium text-text-primary">Pollux</span>
      </div>

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
