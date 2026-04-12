import { db } from "@/lib/db";
import { authConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const KEY = "mcpServers";

export const REDACTED = "********";

export type StdioMcpServer = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type HttpMcpServer = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type SseMcpServer = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type StoredMcpServer = StdioMcpServer | HttpMcpServer | SseMcpServer;

function restoreRedactedMap(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return undefined;
  if (!stored) return incoming;
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = value === REDACTED && key in stored ? stored[key] : value;
  }
  return merged;
}

/**
 * Restore redacted env/headers values before writing. The GET endpoint replaces
 * secrets with the REDACTED sentinel; clients that round-trip the payload would
 * otherwise overwrite real secrets with the placeholder.
 */
export function mergeRedactedSecrets(
  incoming: Record<string, StoredMcpServer>,
  stored: Record<string, StoredMcpServer>,
): Record<string, StoredMcpServer> {
  const result: Record<string, StoredMcpServer> = {};
  for (const [name, server] of Object.entries(incoming)) {
    const storedServer = stored[name];
    if ("env" in server) {
      const storedEnv =
        storedServer && "env" in storedServer ? storedServer.env : undefined;
      result[name] = { ...server, env: restoreRedactedMap(server.env, storedEnv) };
    } else if ("headers" in server) {
      const storedHeaders =
        storedServer && "headers" in storedServer
          ? storedServer.headers
          : undefined;
      result[name] = {
        ...server,
        headers: restoreRedactedMap(server.headers, storedHeaders),
      };
    } else {
      result[name] = server;
    }
  }
  return result;
}

let cached: Record<string, StoredMcpServer> | null = null;

export function getMcpServers(): Record<string, StoredMcpServer> {
  if (cached !== null) return { ...cached };

  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, KEY))
    .get();

  if (!row?.value) {
    cached = {};
    return {};
  }

  try {
    const parsed = JSON.parse(row.value) as Record<string, StoredMcpServer>;
    cached = parsed;
    return { ...parsed };
  } catch {
    cached = {};
    return {};
  }
}

export function validateMcpServer(
  name: string,
  server: StoredMcpServer,
): string | null {
  if (!name.trim()) return "Server name is required";

  const type = server.type ?? "stdio";

  if (type === "stdio") {
    const s = server as StdioMcpServer;
    if (!s.command?.trim()) return `Server "${name}": command is required`;
  } else if (type === "http" || type === "sse") {
    const s = server as HttpMcpServer | SseMcpServer;
    if (!s.url?.trim()) return `Server "${name}": url is required`;
  } else {
    return `Server "${name}": invalid type`;
  }

  return null;
}

export function setMcpServers(
  servers: Record<string, StoredMcpServer>,
): void {
  for (const [name, server] of Object.entries(servers)) {
    const error = validateMcpServer(name, server);
    if (error) throw new Error(error);
  }

  const value = JSON.stringify(servers);

  db.insert(authConfig)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: authConfig.key, set: { value } })
    .run();

  cached = servers;
}
