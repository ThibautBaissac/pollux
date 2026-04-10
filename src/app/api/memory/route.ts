import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readMemoryFile, writeMemoryFile, type MemoryFile } from "@/lib/memory";

function parseFileParam(raw: string | null | undefined): MemoryFile {
  if (raw === "profile" || raw === "knowledge") return raw;
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
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { content, file: rawFile } = body;

  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "Content must be a string" },
      { status: 400 },
    );
  }

  const file = parseFileParam(rawFile);

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
