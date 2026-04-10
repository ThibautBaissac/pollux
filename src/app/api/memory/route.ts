import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readMemoryFile, writeMemoryFile, type MemoryFile } from "@/lib/memory";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

function parseFileParam(raw: string | null | undefined): MemoryFile {
  if (raw === "profile" || raw === "knowledge" || raw === "soul") return raw;
  return "knowledge";
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const file = parseFileParam(request.nextUrl.searchParams.get("file"));
  const content = readMemoryFile(file);
  return NextResponse.json({ content });
}

export async function PUT(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const content = parsed.data.content;
  const rawFile = parsed.data.file;

  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "Content must be a string" },
      { status: 400 },
    );
  }

  const file = parseFileParam(typeof rawFile === "string" ? rawFile : null);

  try {
    writeMemoryFile(file, content);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save memory" },
      { status: 500 },
    );
  }
}
