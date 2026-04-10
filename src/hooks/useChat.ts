"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  ConversationWithMessages,
  Message,
  StreamStatus,
  ToolUse,
} from "@/types";

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

  const applyConversationSnapshot = useCallback(
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
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      if (!res.ok) {
        setError(`Failed to load conversation (${res.status})`);
        setStatus("error");
        return;
      }
      applyConversationSnapshot(res.data);
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
  }, [applyConversationSnapshot, invalidatePendingLoad]);

  const sendMessage = useCallback(
    (text: string) => {
      if (status === "streaming" || status === "loading") return;

      invalidatePendingLoad();
      setStatus("streaming");
      setError(null);

      const pendingConversationId = conversationId ?? crypto.randomUUID();
      const optimisticTitle = text.slice(0, 60);
      if (!conversationId) {
        setTitle(optimisticTitle);
      }

      // Optimistic user message
      const userMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: pendingConversationId,
        role: "user",
        content: text,
        toolUses: null,
        createdAt: new Date().toISOString(),
      };

      // Placeholder assistant message for streaming
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

      function rollbackOptimisticRequest() {
        setMessages((prev) => prev.slice(0, -2));
        if (isNewConversation) {
          setConversationId(null);
          setTitle(null);
        }
      }

      function finalizeFailedStream(message: string) {
        pruneEmptyAssistant();
        setError(message);
        setStatus("error");
      }

      async function reconcileAfterAbort() {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!isMountedRef.current) {
            return false;
          }

          try {
            const snapshot = await fetchConversationSnapshot(
              pendingConversationId,
            );

            if (snapshot.ok) {
              applyConversationSnapshot(snapshot.data);
              if (isNewConversation && !hasNavigated) {
                router.replace(`/chat/${pendingConversationId}`, {
                  scroll: false,
                });
                hasNavigated = true;
                onConversationCreatedRef.current?.();
              }
              return true;
            }

            if (snapshot.status !== 404) {
              setError(`Failed to load conversation (${snapshot.status})`);
              setStatus("error");
              return false;
            }
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") {
              return false;
            }

            if (attempt === 2) {
              setError("Connection failed");
              setStatus("error");
              return false;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 150));
        }

        if (!isMountedRef.current) {
          return false;
        }

        rollbackOptimisticRequest();
        setStatus("idle");
        return false;
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
            if (!isMountedRef.current) {
              return;
            }
            await reconcileAfterAbort();
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
            if (typeof data.title === "string") {
              setTitle(data.title);
            }
            setMessages((prev) =>
              prev.map((message) =>
                message.conversationId === pendingConversationId
                  ? { ...message, conversationId: newConvId }
                  : message,
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
      applyConversationSnapshot,
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
