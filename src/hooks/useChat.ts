"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Message, StreamStatus, ToolUse } from "@/types";

export interface UseChatReturn {
  messages: Message[];
  status: StreamStatus;
  error: string | null;
  conversationId: string | null;
  sendMessage: (text: string) => void;
  cancel: () => void;
  loadConversation: (id: string) => Promise<void>;
  reset: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setStatus("idle");
    setError(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) {
      setError(`Failed to load conversation (${res.status})`);
      return;
    }
    const data = await res.json();
    setConversationId(data.id);
    setMessages(data.messages);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      if (status !== "idle") return;

      setStatus("streaming");
      setError(null);

      // Optimistic user message
      const userMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: conversationId ?? "",
        role: "user",
        content: text,
        toolUses: null,
        createdAt: new Date().toISOString(),
      };

      // Placeholder assistant message for streaming
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: conversationId ?? "",
        role: "assistant",
        content: "",
        toolUses: null,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let hasNavigated = false;

      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, message: text }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            setError(err.error || `Request failed (${res.status})`);
            setStatus("error");
            return;
          }

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let currentEvent = "";

          function processLines(lines: string[]) {
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7);
              } else if (line.startsWith("data: ") && currentEvent) {
                handleEvent(currentEvent, JSON.parse(line.slice(6)));
                currentEvent = "";
              }
            }
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop()!;
            processLines(lines);
          }

          if (buffer.trim()) {
            processLines(buffer.split("\n"));
          }

          // Set idle only if we haven't already moved to error/idle via events
          setStatus((s) => (s === "streaming" ? "idle" : s));
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            setStatus("idle");
          } else {
            setError(
              err instanceof Error ? err.message : "Connection failed",
            );
            setStatus("error");
          }
        }
      })();

      function handleEvent(
        eventType: string,
        data: Record<string, unknown>,
      ) {
        switch (eventType) {
          case "init": {
            const newConvId = data.conversationId as string;
            setConversationId(newConvId);
            if (!hasNavigated) {
              router.replace(`/chat/${newConvId}`, { scroll: false });
              hasNavigated = true;
            }
            break;
          }
          case "delta": {
            const text = data.text as string;
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + text,
                };
              }
              return updated;
            });
            break;
          }
          case "tool": {
            const toolUse: ToolUse = { name: data.name as string };
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === "assistant") {
                const existing = last.toolUses ?? [];
                // Only add if not already present
                if (!existing.some((t) => t.name === toolUse.name)) {
                  updated[updated.length - 1] = {
                    ...last,
                    toolUses: [...existing, toolUse],
                  };
                }
              }
              return updated;
            });
            break;
          }
          case "done": {
            setStatus("idle");
            break;
          }
          case "error": {
            setError(data.message as string);
            setStatus("error");
            break;
          }
        }
      }
    },
    [status, conversationId, router],
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setStatus("idle");
  }, []);

  return {
    messages,
    status,
    error,
    conversationId,
    sendMessage,
    cancel,
    loadConversation,
    reset,
  };
}
