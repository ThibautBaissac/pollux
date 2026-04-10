import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import { getCwd, setCwd } from "@/lib/cwd-store";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({ cwd: getCwd() });
}

export async function PUT(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { cwd } = parsed.data;

  if (typeof cwd !== "string" || !cwd.trim()) {
    return NextResponse.json(
      { error: "Working directory path is required" },
      { status: 400 },
    );
  }

  try {
    setCwd(cwd.trim());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid path";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ cwd: getCwd() });
}
