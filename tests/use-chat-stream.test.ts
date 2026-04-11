import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/types";
import {
  applyConversationId,
  applyDelta,
  applyToolUse,
  parseSseStream,
  pruneTrailingEmptyAssistant,
  reconcileAfterAbort,
} from "@/hooks/useChatStream";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

function sampleMessages(): Message[] {
  return [
    {
      id: "1",
      conversationId: "conv-old",
      role: "user",
      content: "Hi",
      toolUses: null,
      createdAt: "2026-04-10T12:00:00.000Z",
    },
    {
      id: "2",
      conversationId: "conv-old",
      role: "assistant",
      content: "",
      toolUses: null,
      createdAt: "2026-04-10T12:00:01.000Z",
    },
  ];
}

describe("useChatStream helpers", () => {
  it("parses SSE events across chunk boundaries", async () => {
    const stream = streamFromChunks([
      'event: init\ndata: {"conversationId":"conv-1","sessionId":"s1",',
      '"title":"Hello"}\n\n',
      'event: delta\ndata: {"text":"Hi"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);

    const events = [];
    for await (const event of parseSseStream(stream.getReader())) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "init",
        conversationId: "conv-1",
        sessionId: "s1",
        title: "Hello",
      },
      { type: "delta", text: "Hi" },
      { type: "done" },
    ]);
  });

  it("maps unknown SSE events to an error event", async () => {
    const stream = streamFromChunks([
      'event: mystery\ndata: {"value":1}\n\n',
    ]);

    const events = [];
    for await (const event of parseSseStream(stream.getReader())) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "error", message: "Unknown event: mystery" },
    ]);
  });

  it("reconciles aborted streams into resolved, not found, and error states", async () => {
    const resolved = await reconcileAfterAbort("conv-1", async () => ({
      ok: true,
      data: { id: "conv-1", title: "Hello", messages: [] },
    }));
    expect(resolved).toEqual({
      type: "resolved",
      data: { id: "conv-1", title: "Hello", messages: [] },
    });

    vi.useFakeTimers();
    const notFoundPromise = reconcileAfterAbort("conv-1", async () => ({
      ok: false,
      status: 404,
    }));
    await vi.advanceTimersByTimeAsync(450);
    expect(await notFoundPromise).toEqual({ type: "not_found" });

    const error = await reconcileAfterAbort("conv-1", async () => ({
      ok: false,
      status: 500,
    }));
    expect(error).toEqual({
      type: "error",
      message: "Failed to load conversation (500)",
    });

    const aborted = await reconcileAfterAbort("conv-1", async () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    });
    expect(aborted).toEqual({ type: "error", message: "Aborted" });
    vi.useRealTimers();
  });

  it("applies deltas, tool uses, conversation ids, and trailing-message cleanup", () => {
    const withDelta = applyDelta(sampleMessages(), "Hello");
    expect(withDelta[1].content).toBe("Hello");

    const withTool = applyToolUse(withDelta, { name: "WebSearch" });
    expect(withTool[1].toolUses).toEqual([{ name: "WebSearch" }]);
    expect(applyToolUse(withTool, { name: "WebSearch" })[1].toolUses).toEqual([
      { name: "WebSearch" },
      { name: "WebSearch" },
    ]);

    expect(applyConversationId(withTool, "conv-old", "conv-new")).toEqual([
      expect.objectContaining({ conversationId: "conv-new" }),
      expect.objectContaining({ conversationId: "conv-new" }),
    ]);

    expect(pruneTrailingEmptyAssistant(sampleMessages())).toHaveLength(1);
  });
});
