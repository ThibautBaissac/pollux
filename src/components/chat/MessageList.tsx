"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const targetId = searchParams.get("message");
  const lastDeepLinkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!targetId) return;
    if (messages.length === 0) return;
    if (lastDeepLinkedRef.current === targetId) return;

    const el = document.getElementById(`message-${targetId}`);
    if (!el) return;

    lastDeepLinkedRef.current = targetId;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("ring-2", "ring-accent/50", "rounded-lg");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-accent/50", "rounded-lg");
      }, 2500);
    });
  }, [messages, targetId]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        {loading ? (
          <div className="space-y-8">
            <div className="flex justify-end">
              <div className="h-9 w-48 animate-pulse rounded-3xl bg-bg-tertiary" />
            </div>
            <div className="space-y-2.5">
              <div className="h-4 w-72 animate-pulse rounded-full bg-bg-tertiary" />
              <div className="h-4 w-56 animate-pulse rounded-full bg-bg-tertiary" />
              <div className="h-4 w-64 animate-pulse rounded-full bg-bg-tertiary" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-36 animate-pulse rounded-3xl bg-bg-tertiary" />
            </div>
            <div className="space-y-2.5">
              <div className="h-4 w-64 animate-pulse rounded-full bg-bg-tertiary" />
              <div className="h-4 w-48 animate-pulse rounded-full bg-bg-tertiary" />
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              id={`message-${msg.id}`}
              message={msg}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
