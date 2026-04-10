"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  ConversationWithMessages,
  Message,
  StreamStatus,
} from "@/types";
import {
  parseSseStream,
  reconcileAfterAbort,
  applyDelta,
  applyToolUse,
  applyConversationId,
  pruneTrailingEmptyAssistant,
} from "./useChatStream";

export interface UseChatOptions {
  onConversationCreated?: () => void;
}

export interface UseChatReturn {
  messages: Message[];
  status: StreamStatus;
  error: string | null;
  conversationId: string | null;
  title: string | null;
  sendMessage: (text: string) => void;
  cancel: () => void;
  loadConversation: (id: string) => Promise<void>;
  reset: () => void;
}

async function fetchConversationSnapshot(
  id: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; data: ConversationWithMessages }
  | { ok: false; status: number }
> {
  const res = await fetch(`/api/conversations/${id}`, { signal });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  return {
    ok: true,
    data: (await res.json()) as ConversationWithMessages,
  };
}

export function useChat(options?: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadRequestIdRef = useRef(0);
  const onConversationCreatedRef = useRef(options?.onConversationCreated);
  const router = useRouter();

  useEffect(() => {
    onConversationCreatedRef.current = options?.onConversationCreated;
  }, [options?.onConversationCreated]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      loadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    function handleConversationRenamed(event: Event) {
      const customEvent = event as CustomEvent<{ id?: string; title?: string }>;
      if (
        customEvent.detail?.id &&
        customEvent.detail.id === conversationId &&
        typeof customEvent.detail.title === "string"
      ) {
        setTitle(customEvent.detail.title);
      }
    }

    window.addEventListener(
      "pollux:conversation-renamed",
      handleConversationRenamed,
    );
    return () =>
      window.removeEventListener(
        "pollux:conversation-renamed",
        handleConversationRenamed,
      );
  }, [conversationId]);

  const applySnapshot = useCallback(
    (data: ConversationWithMessages) => {
      if (!isMountedRef.current) return;
      setConversationId(data.id);
      setTitle(data.title ?? null);
      setMessages(data.messages);
      setError(null);
      setStatus("idle");
    },
    [],
  );

  const invalidatePendingLoad = useCallback(() => {
    loadRequestIdRef.current += 1;
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    invalidatePendingLoad();
    setMessages([]);
    setConversationId(null);
    setTitle(null);
    setStatus("idle");
    setError(null);
  }, [invalidatePendingLoad]);

  const loadConversation = useCallback(async (id: string) => {
    invalidatePendingLoad();
    const requestId = loadRequestIdRef.current;
    const controller = new AbortController();
    loadControllerRef.current = controller;

    setConversationId(id);
    setTitle(null);
    setMessages([]);
    setStatus("loading");
    setError(null);
    try {
      const res = await fetchConversationSnapshot(id, controller.signal);
      if (requestId !== loadRequestIdRef.current) return;
      if (!res.ok) {
        setError(`Failed to load conversation (${res.status})`);
        setStatus("error");
        return;
      }
      applySnapshot(res.data);
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
  }, [applySnapshot, invalidatePendingLoad]);

  const sendMessage = useCallback(
    (text: string) => {
      if (status === "streaming" || status === "loading") return;

      invalidatePendingLoad();
      setStatus("streaming");
      setError(null);

      const pendingConversationId = conversationId ?? crypto.randomUUID();
      if (!conversationId) {
        setTitle(text.slice(0, 60));
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: pendingConversationId,
        role: "user",
        content: text,
        toolUses: null,
        createdAt: new Date().toISOString(),
      };

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: pendingConversationId,
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

      function rollback() {
        setMessages((prev) => prev.slice(0, -2));
        if (isNewConversation) {
          setConversationId(null);
          setTitle(null);
        }
      }

      function navigateToConversation(convId: string) {
        if (hasNavigated) return;
        router.replace(`/chat/${convId}`, { scroll: false });
        hasNavigated = true;
        if (isNewConversation) {
          onConversationCreatedRef.current?.();
        }
      }

      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: pendingConversationId,
              createIfMissing: isNewConversation,
              message: text,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            rollback();
            setError(err.error || `Request failed (${res.status})`);
            setStatus("error");
            return;
          }

          requestAccepted = true;

          for await (const event of parseSseStream(res.body!.getReader())) {
            switch (event.type) {
              case "init":
                setConversationId(event.conversationId);
                if (typeof event.title === "string") {
                  setTitle(event.title);
                }
                setMessages((prev) =>
                  applyConversationId(
                    prev,
                    pendingConversationId,
                    event.conversationId,
                  ),
                );
                navigateToConversation(event.conversationId);
                break;

              case "delta":
                setMessages((prev) => applyDelta(prev, event.text));
                break;

              case "tool":
                setMessages((prev) =>
                  applyToolUse(prev, { name: event.name }),
                );
                break;

              case "done":
                setMessages((prev) => pruneTrailingEmptyAssistant(prev));
                setStatus("idle");
                break;

              case "error":
                setMessages((prev) => pruneTrailingEmptyAssistant(prev));
                setError(event.message);
                setStatus("error");
                break;
            }
          }

          setMessages((prev) => pruneTrailingEmptyAssistant(prev));
          setStatus((s) => (s === "streaming" ? "idle" : s));
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            if (!isMountedRef.current) return;

            const result = await reconcileAfterAbort(
              pendingConversationId,
              fetchConversationSnapshot,
            );

            if (!isMountedRef.current) return;

            switch (result.type) {
              case "resolved":
                applySnapshot(
                  result.data as ConversationWithMessages,
                );
                navigateToConversation(pendingConversationId);
                break;
              case "not_found":
                rollback();
                setStatus("idle");
                break;
              case "error":
                setError(result.message);
                setStatus("error");
                break;
            }
          } else {
            const message =
              err instanceof Error ? err.message : "Connection failed";
            if (requestAccepted) {
              setMessages((prev) => pruneTrailingEmptyAssistant(prev));
              setError(message);
              setStatus("error");
            } else {
              rollback();
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
    },
    [
      applySnapshot,
      status,
      conversationId,
      router,
      invalidatePendingLoad,
    ],
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  return {
    messages,
    status,
    error,
    conversationId,
    title,
    sendMessage,
    cancel,
    loadConversation,
    reset,
  };
}
