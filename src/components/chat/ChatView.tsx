"use client";

import Link from "next/link";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChatStream } from "./ChatStreamProvider";

export function ChatView() {
  const { messages, status, error, title } = useChatStream();
  const isEmpty = messages.length === 0 && status !== "loading";

  return (
    <div className="flex h-full flex-col">
      {/* Desktop header — shown when conversation is active */}
      {!isEmpty && (
        <div className="hidden items-center px-6 py-3 md:flex">
          <span className="truncate text-sm font-medium text-text-secondary">
            {title ?? "Pollux"}
          </span>
        </div>
      )}

      {/* Mobile header */}
      <div className="flex items-center gap-2 p-3 md:hidden">
        <Link href="/chat" className="text-text-secondary hover:text-text-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <span className="truncate text-sm font-medium text-text-primary">
          {title ?? "Pollux"}
        </span>
      </div>

      {error && (
        <div className="border-b border-border bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {error}
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-semibold text-text-primary">
              How can I help you?
            </h1>
          </div>
          <div className="w-full max-w-2xl">
            <ChatInput />
          </div>
        </div>
      ) : (
        <>
          <MessageList messages={messages} loading={status === "loading"} />
          <ChatInput />
        </>
      )}
    </div>
  );
}
