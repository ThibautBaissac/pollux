import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { conversations, messages } from "@/lib/db/schema";
import { createTestDb, type TestDbContext } from "./helpers/test-db";

describe("chat", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  async function loadChatModule(options: {
    memoryContent?: string;
    startAgentImpl?: (params: {
      userMessage: string;
      memoryContent: string;
      sdkSessionId?: string;
      conversationId?: string;
      abortController: AbortController;
    }) => AsyncIterable<unknown>;
  } = {}) {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    vi.doMock("@/lib/memory", () => ({
      readMemory: () => options.memoryContent ?? "memory context",
    }));
    vi.doMock("@/lib/agent", () => ({
      startAgent:
        options.startAgentImpl ??
        (() =>
          (async function* () {
            yield { type: "result", total_cost_usd: 0, num_turns: 0 };
          })()),
    }));
    return import("@/lib/chat");
  }

  async function readStream(stream: ReadableStream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    return text;
  }

  function seedConversation(id = "conv-1", sdkSessionId: string | null = null) {
    const now = new Date();
    testDb.db
      .insert(conversations)
      .values({
        id,
        sdkSessionId,
        title: "Existing conversation",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  it("resolves existing, missing, and new conversations", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("new-conv-id");
    const { resolveConversation } = await loadChatModule();
    seedConversation("existing", "sdk-1");

    expect(resolveConversation("existing", false, "Hello world")).toEqual({
      convId: "existing",
      sdkSessionId: "sdk-1",
      title: "Hello world",
    });
    expect(resolveConversation("missing", false, "Hello world")).toEqual({
      error: "Conversation not found",
      status: 404,
    });
    expect(resolveConversation("missing", true, "Hello world")).toEqual({
      convId: "missing",
      sdkSessionId: undefined,
      title: "Hello world",
    });
    expect(resolveConversation(undefined, false, "Hello world")).toEqual({
      convId: "new-conv-id",
      sdkSessionId: undefined,
      title: "Hello world",
    });
  });

  it("persists user messages and updates the conversation timestamp", async () => {
    const { persistUserMessage } = await loadChatModule();
    seedConversation();

    const before = testDb.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, "conv-1"))
      .get();

    persistUserMessage("conv-1", "Hello");

    const storedMessages = testDb.db.select().from(messages).all();
    const updatedConversation = testDb.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, "conv-1"))
      .get();

    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0]).toMatchObject({
      conversationId: "conv-1",
      role: "user",
      content: "Hello",
    });
    expect(updatedConversation!.updatedAt >= before!.updatedAt).toBe(true);
  });

  it("streams agent output, emits SSE events, and persists assistant tool uses", async () => {
    const { createChatStream } = await loadChatModule({
      startAgentImpl: () =>
        (async function* () {
          yield { type: "system", subtype: "init", session_id: "sdk-2" };
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "Hello " },
            },
          };
          yield {
            type: "tool_progress",
            tool_name: "WebSearch",
            elapsed_time_seconds: 1,
          };
          yield {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", name: "WebFetch" },
                { type: "text", text: "Hello world" },
              ],
            },
          };
          yield { type: "result", total_cost_usd: 0.12, num_turns: 2 };
        })(),
    });
    seedConversation();

    const stream = createChatStream({
      convId: "conv-1",
      sdkSessionId: undefined,
      title: "Hello world",
      message: "Hello world",
      abortSignal: new AbortController().signal,
    });
    const output = await readStream(stream);

    expect(output).toContain('event: init');
    expect(output).toContain('"conversationId":"conv-1"');
    expect(output).toContain('event: delta');
    expect(output).toContain('"text":"Hello "');
    expect(output).toContain('event: tool');
    expect(output).toContain('"name":"WebSearch"');
    expect(output).toContain('event: done');

    const storedAssistant = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.role, "assistant"))
      .get();

    expect(storedAssistant?.content).toBe("Hello world");
    expect(JSON.parse(storedAssistant?.toolUses ?? "[]")).toEqual([
      { name: "WebFetch" },
    ]);
    expect(
      testDb.db
        .select()
        .from(conversations)
        .where(eq(conversations.id, "conv-1"))
        .get()?.sdkSessionId,
    ).toBe("sdk-2");
  });

  it("retries once when resuming an existing session fails", async () => {
    const startAgent = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Resume failed");
      })
      .mockImplementationOnce(() =>
        (async function* () {
          yield { type: "system", subtype: "init", session_id: "sdk-fresh" };
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Retried" }] },
          };
          yield { type: "result", total_cost_usd: 0, num_turns: 1 };
        })()
      );
    const { createChatStream } = await loadChatModule({
      startAgentImpl: startAgent,
    });
    seedConversation("conv-1", "sdk-stale");

    await readStream(
      createChatStream({
        convId: "conv-1",
        sdkSessionId: "sdk-stale",
        title: "Retry",
        message: "Retry",
        abortSignal: new AbortController().signal,
      }),
    );

    expect(startAgent).toHaveBeenCalledTimes(2);
    expect(startAgent.mock.calls[0][0].sdkSessionId).toBe("sdk-stale");
    expect(startAgent.mock.calls[1][0].sdkSessionId).toBeUndefined();
  });

  it("passes the current conversation id into the agent context", async () => {
    const startAgent = vi.fn().mockImplementation(
      () =>
        (async function* () {
          yield { type: "result", total_cost_usd: 0, num_turns: 0 };
        })(),
    );
    const { createChatStream } = await loadChatModule({
      startAgentImpl: startAgent,
    });
    seedConversation("conv-ctx");

    await readStream(
      createChatStream({
        convId: "conv-ctx",
        sdkSessionId: undefined,
        title: "Reminder",
        message: 'remind me to "go for a walk" today at 14:45 Paris time',
        abortSignal: new AbortController().signal,
      }),
    );

    expect(startAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-ctx",
      }),
    );
  });

  it("persists partial assistant output when the stream is aborted", async () => {
    const requestAbort = new AbortController();
    const startAgent = vi.fn().mockImplementation(
      (params: { abortController: AbortController }) =>
        (async function* () {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "Partial reply" },
            },
          };
          requestAbort.abort();
          await new Promise((_resolve, reject) => {
            if (params.abortController.signal.aborted) {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
              return;
            }
            params.abortController.signal.addEventListener(
              "abort",
              () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true },
            );
          });
        })(),
    );
    const { createChatStream } = await loadChatModule({
      startAgentImpl: startAgent,
    });
    seedConversation();

    const streamPromise = readStream(
      createChatStream({
        convId: "conv-1",
        sdkSessionId: undefined,
        title: "Abort",
        message: "Abort",
        abortSignal: requestAbort.signal,
      }),
    );

    await streamPromise;

    const storedAssistant = testDb.db
      .select()
      .from(messages)
      .where(eq(messages.role, "assistant"))
      .get();

    expect(storedAssistant?.content).toBe("Partial reply");
  });
});
