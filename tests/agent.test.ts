import { afterEach, describe, expect, it, vi } from "vitest";

describe("agent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-allows the built-in reminder MCP tool", async () => {
    const query = vi.fn(() => ({
      [Symbol.asyncIterator]: async function* () {},
    }));

    vi.resetModules();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/cwd-store", () => ({
      getCwd: () => "/tmp/pollux",
    }));
    vi.doMock("@/lib/mcp-store", () => ({
      getMcpServers: () => ({}),
    }));
    vi.doMock("@/lib/reminder-tool", () => ({
      REMINDER_MCP_SERVER_NAME: "pollux-reminders",
      REMINDER_MCP_TOOL_NAME: "reminder",
      reminderMcpServer: { name: "pollux-reminders" },
    }));

    const { startAgent } = await import("@/lib/agent");

    startAgent({
      userMessage: 'remind me to "go for a walk" today at 14:30 Paris time',
      memoryContent: "memory",
      model: "claude-sonnet",
      sdkSessionId: "sdk-1",
      conversationId: "conv-1",
      abortController: new AbortController(),
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Current conversation ID: conv-1"),
        options: expect.objectContaining({
          permissionMode: "dontAsk",
          allowedTools: expect.arrayContaining([
            "WebSearch",
            "mcp__pollux-reminders__reminder",
          ]),
          mcpServers: expect.objectContaining({
            "pollux-reminders": expect.any(Object),
          }),
        }),
      }),
    );
  });
});
