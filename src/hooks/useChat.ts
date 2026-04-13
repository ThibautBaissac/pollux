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
import { AVAILABLE_MODELS } from "@/lib/models";
import type { SlashCommandName } from "@/lib/slash-commands";

const RESET_ABORT_REASON = "pollux:reset";

export interface UseChatOptions {
  onConversationCreated?: () => void;
}

export interface LastResponseCost {
  costUsd?: number;
  turns?: number;
}

export interface UseChatReturn {
  messages: Message[];
  status: StreamStatus;
  error: string | null;
  conversationId: string | null;
  title: string | null;
  modelId: string | null;
  sendMessage: (text: string) => void;
  cancel: () => void;
  loadConversation: (id: string) => Promise<void>;
  reset: () => void;
  dispatchCommand: (name: SlashCommandName) => void;
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
  const [modelId, setModelId] = useState<string | null>(null);
  const lastCostRef = useRef<LastResponseCost | null>(null);
  const messagesRef = useRef<Message[]>(messages);
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
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/settings/model", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (typeof data?.model === "string") setModelId(data.model);
      })
      .catch(() => {});
    return () => ac.abort();
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
    abortControllerRef.current?.abort(RESET_ABORT_REASON);
    abortControllerRef.current = null;
    invalidatePendingLoad();
    setMessages([]);
    setConversationId(null);
    setTitle(null);
    setStatus("idle");
    setError(null);
    lastCostRef.current = null;
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
                lastCostRef.current = {
                  costUsd: event.costUsd,
                  turns: event.turns,
                };
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
            if (controller.signal.reason === RESET_ABORT_REASON) return;

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

  const pushSystemMessage = useCallback(
    (content: string): string => {
      const id = crypto.randomUUID();
      const msg: Message = {
        id,
        conversationId: conversationId ?? "local",
        role: "system",
        content,
        toolUses: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [...prev.slice(0, -1), msg, last];
        }
        return [...prev, msg];
      });
      return id;
    },
    [conversationId],
  );

  const replaceSystemMessage = useCallback(
    (id: string, content: string) => {
      setMessages((prev) => {
        const idx = prev.findIndex(
          (m) => m.id === id && m.role === "system",
        );
        if (idx === -1) return prev;
        const next = prev.slice();
        next[idx] = { ...next[idx], content };
        return next;
      });
    },
    [],
  );

  const runDreamCommand = useCallback(async () => {
    const placeholderId = pushSystemMessage("Dreaming…");
    let message: string;
    try {
      const res = await fetch("/api/dream/run", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        summarized?: number;
        edited?: boolean;
        durationMs?: number;
      };
      if (res.status === 409) {
        message = "Dream is already running.";
      } else if (!res.ok) {
        message = body.error ?? `Dream failed (${res.status}).`;
      } else {
        const seconds = ((body.durationMs ?? 0) / 1000).toFixed(1);
        message = `Dream complete · summarized ${body.summarized ?? 0} · ${
          body.edited ? "memory edited" : "no memory edits"
        } · ${seconds}s`;
      }
    } catch {
      message = "Dream request failed.";
    }
    if (!isMountedRef.current) return;
    replaceSystemMessage(placeholderId, message);
  }, [pushSystemMessage, replaceSystemMessage]);

  const dispatchCommand = useCallback(
    (name: SlashCommandName) => {
      switch (name) {
        case "new": {
          reset();
          router.push("/chat");
          return;
        }
        case "stop": {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          } else {
            pushSystemMessage("Nothing is streaming.");
          }
          return;
        }
        case "status": {
          const label =
            AVAILABLE_MODELS.find((m) => m.id === modelId)?.label ??
            modelId ??
            "unknown";
          const last = lastCostRef.current;
          const cost =
            typeof last?.costUsd === "number"
              ? `$${last.costUsd.toFixed(4)}`
              : "n/a";
          const turns =
            typeof last?.turns === "number" ? String(last.turns) : "n/a";
          const visibleMessages = messagesRef.current.filter(
            (m) => m.role !== "system",
          ).length;
          pushSystemMessage(
            [
              `Model: ${label}`,
              `Conversation: ${title ?? "—"} (${conversationId ?? "new"})`,
              `Messages: ${visibleMessages}`,
              `Status: ${status}`,
              `Last response: ${cost} · ${turns} turns`,
            ].join("\n"),
          );
          return;
        }
        case "dream": {
          void runDreamCommand();
          return;
        }
        case "skills": {
          router.push("/settings?section=skills");
          return;
        }
      }
    },
    [
      conversationId,
      modelId,
      pushSystemMessage,
      reset,
      router,
      runDreamCommand,
      status,
      title,
    ],
  );

  return {
    messages,
    status,
    error,
    conversationId,
    title,
    modelId,
    sendMessage,
    cancel,
    loadConversation,
    reset,
    dispatchCommand,
  };
}
