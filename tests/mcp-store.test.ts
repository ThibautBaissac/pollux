import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDbContext } from "./helpers/test-db";
import type { StoredMcpServer } from "@/lib/mcp-store";

describe("mcp-store", () => {
  let testDb: TestDbContext;

  beforeEach(() => {
    testDb = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  async function loadMcpStore() {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: testDb.db }));
    return import("@/lib/mcp-store");
  }

  it("returns empty object when no servers configured", async () => {
    const { getMcpServers } = await loadMcpStore();
    expect(getMcpServers()).toEqual({});
  });

  it("setMcpServers persists and getMcpServers reads back", async () => {
    const { getMcpServers, setMcpServers } = await loadMcpStore();

    const servers: Record<string, StoredMcpServer> = {
      "my-server": { command: "node", args: ["./server.js"] },
    };

    setMcpServers(servers);
    expect(getMcpServers()).toEqual(servers);
  });

  it("supports all three transport types", async () => {
    const { getMcpServers, setMcpServers } = await loadMcpStore();

    const servers: Record<string, StoredMcpServer> = {
      local: { command: "npx", args: ["-y", "@mcp/server"] },
      remote: { type: "http", url: "https://example.com/mcp" },
      stream: { type: "sse", url: "https://example.com/sse" },
    };

    setMcpServers(servers);
    expect(getMcpServers()).toEqual(servers);
  });

  it("setMcpServers overwrites previous config", async () => {
    const { getMcpServers, setMcpServers } = await loadMcpStore();

    setMcpServers({ a: { command: "a" } });
    setMcpServers({ b: { command: "b" } });

    const result = getMcpServers();
    expect(result).toEqual({ b: { command: "b" } });
    expect(result).not.toHaveProperty("a");
  });

  it("setMcpServers accepts empty object to clear all", async () => {
    const { getMcpServers, setMcpServers } = await loadMcpStore();

    setMcpServers({ a: { command: "a" } });
    setMcpServers({});
    expect(getMcpServers()).toEqual({});
  });

  it("rejects stdio server without command", async () => {
    const { setMcpServers } = await loadMcpStore();

    expect(() =>
      setMcpServers({ bad: { command: "" } }),
    ).toThrow("command is required");
  });

  it("rejects http server without url", async () => {
    const { setMcpServers } = await loadMcpStore();

    expect(() =>
      setMcpServers({ bad: { type: "http", url: "" } as StoredMcpServer }),
    ).toThrow("url is required");
  });

  it("rejects server with empty name", async () => {
    const { setMcpServers } = await loadMcpStore();

    expect(() =>
      setMcpServers({ "": { command: "node" } }),
    ).toThrow("Server name is required");
  });

  it("mergeRedactedSecrets preserves stored env when value is redacted", async () => {
    const { mergeRedactedSecrets, REDACTED } = await loadMcpStore();

    const stored: Record<string, StoredMcpServer> = {
      srv: {
        command: "node",
        env: { API_KEY: "secret-value", DEBUG: "1" },
      },
    };
    const incoming: Record<string, StoredMcpServer> = {
      srv: {
        command: "node",
        env: { API_KEY: REDACTED, DEBUG: "2" },
      },
    };

    const merged = mergeRedactedSecrets(incoming, stored);

    expect((merged.srv as { env: Record<string, string> }).env).toEqual({
      API_KEY: "secret-value",
      DEBUG: "2",
    });
  });

  it("mergeRedactedSecrets preserves stored headers when value is redacted", async () => {
    const { mergeRedactedSecrets, REDACTED } = await loadMcpStore();

    const stored: Record<string, StoredMcpServer> = {
      api: {
        type: "http",
        url: "https://example.com",
        headers: { Authorization: "Bearer real-token" },
      },
    };
    const incoming: Record<string, StoredMcpServer> = {
      api: {
        type: "http",
        url: "https://example.com",
        headers: { Authorization: REDACTED },
      },
    };

    const merged = mergeRedactedSecrets(incoming, stored);

    expect(
      (merged.api as { headers: Record<string, string> }).headers,
    ).toEqual({ Authorization: "Bearer real-token" });
  });

  it("mergeRedactedSecrets passes through new servers unchanged", async () => {
    const { mergeRedactedSecrets } = await loadMcpStore();

    const incoming: Record<string, StoredMcpServer> = {
      fresh: { command: "node", env: { NEW_KEY: "new-value" } },
    };

    const merged = mergeRedactedSecrets(incoming, {});

    expect(merged).toEqual(incoming);
  });
});
