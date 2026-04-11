import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import {
  getMcpServers,
  setMcpServers,
  type StoredMcpServer,
} from "@/lib/mcp-store";

function redactSecrets(
  servers: Record<string, StoredMcpServer>,
): Record<string, StoredMcpServer> {
  const redacted: Record<string, StoredMcpServer> = {};
  for (const [name, server] of Object.entries(servers)) {
    const { ...safe } = server;
    if ("env" in safe) {
      (safe as Record<string, unknown>).env = Object.fromEntries(
        Object.keys(safe.env!).map((k) => [k, "********"]),
      );
    }
    if ("headers" in safe) {
      (safe as Record<string, unknown>).headers = Object.fromEntries(
        Object.keys(safe.headers!).map((k) => [k, "********"]),
      );
    }
    redacted[name] = safe;
  }
  return redacted;
}

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({ servers: redactSecrets(getMcpServers()) });
}

export async function PUT(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { servers } = parsed.data;

  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return NextResponse.json(
      { error: "servers must be an object" },
      { status: 400 },
    );
  }

  try {
    setMcpServers(servers as Record<string, StoredMcpServer>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid config";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ servers: getMcpServers() });
}
