"use client";

import type { ToolUse } from "@/types";

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export interface SseInitEvent {
  type: "init";
  conversationId: string;
  sessionId: string;
  title: string;
}

export interface SseDeltaEvent {
  type: "delta";
  text: string;
}

export interface SseToolEvent {
  type: "tool";
  name: string;
}

export interface SseDoneEvent {
  type: "done";
}

export interface SseErrorEvent {
  type: "error";
  message: string;
}

export type SseEvent =
  | SseInitEvent
  | SseDeltaEvent
  | SseToolEvent
  | SseDoneEvent
  | SseErrorEvent;

// ---------------------------------------------------------------------------
// SSE stream parser — yields typed events from a ReadableStream
// ---------------------------------------------------------------------------

export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  function* parseLines(lines: string[]): Generator<SseEvent> {
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7);
      } else if (line.startsWith("data: ") && currentEvent) {
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
        yield mapEvent(currentEvent, data);
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
    yield* parseLines(lines);
  }

  if (buffer.trim()) {
    yield* parseLines(buffer.split("\n"));
  }
}

function mapEvent(
  eventType: string,
  data: Record<string, unknown>,
): SseEvent {
  switch (eventType) {
    case "init":
      return {
        type: "init",
        conversationId: data.conversationId as string,
        sessionId: data.sessionId as string,
        title: data.title as string,
      };
    case "delta":
      return { type: "delta", text: data.text as string };
    case "tool":
      return { type: "tool", name: data.name as string };
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: data.message as string };
    default:
      return { type: "error", message: `Unknown event: ${eventType}` };
  }
}

// ---------------------------------------------------------------------------
// Abort reconciliation — fetch final state after stream abort
// ---------------------------------------------------------------------------

export interface ConversationSnapshot {
  id: string;
  title?: string;
  messages: unknown[];
}

export async function reconcileAfterAbort(
  conversationId: string,
  fetchSnapshot: (
    id: string,
  ) => Promise<
    | { ok: true; data: ConversationSnapshot }
    | { ok: false; status: number }
  >,
): Promise<
  | { type: "resolved"; data: ConversationSnapshot }
  | { type: "not_found" }
  | { type: "error"; message: string }
> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const snapshot = await fetchSnapshot(conversationId);

      if (snapshot.ok) {
        return { type: "resolved", data: snapshot.data };
      }

      if (snapshot.status !== 404) {
        return {
          type: "error",
          message: `Failed to load conversation (${snapshot.status})`,
        };
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { type: "error", message: "Aborted" };
      }

      if (attempt === 2) {
        return { type: "error", message: "Connection failed" };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return { type: "not_found" };
}

// ---------------------------------------------------------------------------
// Apply SSE events to message state
// ---------------------------------------------------------------------------

import type { Message } from "@/types";

export function applyDelta(messages: Message[], text: string): Message[] {
  const updated = [...messages];
  const last = updated[updated.length - 1];
  if (last && last.role === "assistant") {
    updated[updated.length - 1] = {
      ...last,
      content: last.content + text,
    };
  }
  return updated;
}

export function applyToolUse(messages: Message[], toolUse: ToolUse): Message[] {
  const updated = [...messages];
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
}

export function applyConversationId(
  messages: Message[],
  oldId: string,
  newId: string,
): Message[] {
  return messages.map((m) =>
    m.conversationId === oldId ? { ...m, conversationId: newId } : m,
  );
}

export function pruneTrailingEmptyAssistant(messages: Message[]): Message[] {
  const updated = [...messages];
  const last = updated[updated.length - 1];
  if (last?.role === "assistant" && !last.content.trim()) {
    updated.pop();
  }
  return updated;
}
