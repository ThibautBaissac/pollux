import { db } from "@/lib/db";
import { authConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const KEY = "mcpServers";

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
