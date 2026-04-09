"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Message, StreamStatus, ToolUse } from "@/types";

export interface UseChatOptions {
  onConversationCreated?: () => void;
}

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

export function useChat(options?: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadRequestIdRef = useRef(0);
  const onConversationCreatedRef = useRef(options?.onConversationCreated);
  const router = useRouter();

  useEffect(() => {
    onConversationCreatedRef.current = options?.onConversationCreated;
  }, [options?.onConversationCreated]);

  const invalidatePendingLoad = useCallback(() => {
    loadRequestIdRef.current += 1;
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
  }, []);

  const pruneEmptyAssistant = useCallback(() => {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant" && !last.content.trim()) {
        updated.pop();
      }
      return updated;
    });
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    invalidatePendingLoad();
    setMessages([]);
    setConversationId(null);
    setStatus("idle");
    setError(null);
  }, [invalidatePendingLoad]);

  const loadConversation = useCallback(async (id: string) => {
    invalidatePendingLoad();
    const requestId = loadRequestIdRef.current;
    const controller = new AbortController();
    loadControllerRef.current = controller;

    setConversationId(id);
    setMessages([]);
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        signal: controller.signal,
      });
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      if (!res.ok) {
        setError(`Failed to load conversation (${res.status})`);
        setStatus("error");
        return;
      }
      const data = await res.json();
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      setConversationId(data.id);
      setMessages(data.messages);
      setStatus("idle");
    } catch (err: unknown) {
      if (
        controller.signal.aborted ||
        requestId !== loadRequestIdRef.current ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      setError("Connection failed");
      setStatus("error");
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
      }
    }
  }, [invalidatePendingLoad]);

  const sendMessage = useCallback(
    (text: string) => {
      if (status === "streaming" || status === "loading") return;

      invalidatePendingLoad();
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

      let requestAccepted = false;
      let hasNavigated = false;
      const isNewConversation = !conversationId;

      function rollbackOptimisticRequest() {
        setMessages((prev) => prev.slice(0, -2));
      }

      function finalizeFailedStream(message: string) {
        pruneEmptyAssistant();
        setError(message);
        setStatus("error");
      }

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
            rollbackOptimisticRequest();
            setError(err.error || `Request failed (${res.status})`);
            setStatus("error");
            return;
          }

          requestAccepted = true;

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

          pruneEmptyAssistant();
          setStatus((s) => (s === "streaming" ? "idle" : s));
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            if (requestAccepted) {
              pruneEmptyAssistant();
            } else {
              rollbackOptimisticRequest();
            }
            setStatus("idle");
          } else {
            const message =
              err instanceof Error ? err.message : "Connection failed";
            if (requestAccepted) {
              finalizeFailedStream(message);
            } else {
              rollbackOptimisticRequest();
              setError(message);
              setStatus("error");
            }
          }
        } finally {
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
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
            setMessages((prev) =>
              prev.map((message) =>
                message.conversationId
                  ? message
                  : { ...message, conversationId: newConvId },
              ),
            );
            if (!hasNavigated) {
              router.replace(`/chat/${newConvId}`, { scroll: false });
              hasNavigated = true;
              if (isNewConversation) {
                onConversationCreatedRef.current?.();
              }
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
            pruneEmptyAssistant();
            setStatus("idle");
            break;
          }
          case "error": {
            finalizeFailedStream(data.message as string);
            break;
          }
        }
      }
    },
    [
      status,
      conversationId,
      router,
      invalidatePendingLoad,
      pruneEmptyAssistant,
    ],
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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
