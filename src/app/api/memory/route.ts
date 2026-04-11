import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readMemoryFile, writeMemoryFile, type MemoryFile } from "@/lib/memory";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

const VALID_FILES = new Set<MemoryFile>(["profile", "knowledge", "soul"]);

function parseFileParam(
  raw: string | null | undefined,
): MemoryFile | null {
  if (raw && VALID_FILES.has(raw as MemoryFile)) return raw as MemoryFile;
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const file = parseFileParam(request.nextUrl.searchParams.get("file"));
  if (!file) {
    return NextResponse.json(
      { error: "Invalid file parameter. Must be: profile, knowledge, or soul" },
      { status: 400 },
    );
  }
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
  if (!file) {
    return NextResponse.json(
      { error: "Invalid file parameter. Must be: profile, knowledge, or soul" },
      { status: 400 },
    );
  }

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
