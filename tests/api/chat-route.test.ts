import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { buildJsonRequest } from "../helpers/requests";

describe("chat API route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute(options: {
    requestError?: Response | null;
    authError?: Response | null;
    resolveConversation?: () => unknown;
    createChatStream?: () => ReadableStream;
  } = {}) {
    const persistUserMessage = vi.fn();
    const createChatStream =
      vi.fn(options.createChatStream) ??
      vi.fn(() => new ReadableStream());

    vi.resetModules();
    vi.doMock("@/lib/request-guards", () => ({
      requireTrustedRequest: () => options.requestError ?? null,
      readJsonObject: async (request: Request) => ({
        data: (await request.json()) as Record<string, unknown>,
      }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireAuth: async () => options.authError ?? null,
    }));
    vi.doMock("@/lib/chat", () => ({
      resolveConversation:
        options.resolveConversation ??
        (() => ({
          convId: "conv-1",
          sdkSessionId: undefined,
          title: "Hello",
        })),
      persistUserMessage,
      createChatStream,
    }));

    return {
      persistUserMessage,
      createChatStream,
      route: await import("@/app/api/chat/route"),
    };
  }

  it("returns request guard errors before doing any work", async () => {
    const { route, persistUserMessage } = await loadRoute({
      requestError: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await route.POST(
      buildJsonRequest("http://localhost/api/chat", { message: "Hello" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(persistUserMessage).not.toHaveBeenCalled();
  });

  it("validates request fields before starting a stream", async () => {
    const { route, persistUserMessage } = await loadRoute();

    const invalidConversationId = await route.POST(
      buildJsonRequest("http://localhost/api/chat", {
        conversationId: 123,
        message: "Hello",
      }),
    );
    expect(invalidConversationId.status).toBe(400);

    const invalidCreateIfMissing = await route.POST(
      buildJsonRequest("http://localhost/api/chat", {
        createIfMissing: "yes",
        message: "Hello",
      }),
    );
    expect(invalidCreateIfMissing.status).toBe(400);

    const invalidMessage = await route.POST(
      buildJsonRequest("http://localhost/api/chat", {
        message: "   ",
      }),
    );
    expect(invalidMessage.status).toBe(400);
    expect(await invalidMessage.json()).toEqual({ error: "Message is required" });
    expect(persistUserMessage).not.toHaveBeenCalled();
  });

  it("returns conversation resolution errors", async () => {
    const { route } = await loadRoute({
      resolveConversation: () => ({
        error: "Conversation not found",
        status: 404,
      }),
    });

    const response = await route.POST(
      buildJsonRequest("http://localhost/api/chat", {
        conversationId: "missing",
        message: "Hello",
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Conversation not found" });
  });

  it("persists the user message and returns an SSE response", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: done\ndata: {"costUsd":0,"turns":1}\n\n',
          ),
        );
        controller.close();
      },
    });
    const { route, persistUserMessage, createChatStream } = await loadRoute({
      createChatStream: () => stream,
    });

    const response = await route.POST(
      buildJsonRequest("http://localhost/api/chat", {
        conversationId: "conv-1",
        message: "Hello",
        createIfMissing: false,
      }),
    );

    expect(persistUserMessage).toHaveBeenCalledWith("conv-1", "Hello");
    expect(createChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        convId: "conv-1",
        message: "Hello",
        title: "Hello",
      }),
    );
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });
});
