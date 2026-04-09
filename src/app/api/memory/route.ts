import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readMemory, writeMemory } from "@/lib/memory";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const content = readMemory();
  return NextResponse.json({ content });
}

export async function PUT(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { content } = body;

  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "Content must be a string" },
      { status: 400 },
    );
  }

  try {
    writeMemory(content);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save memory" },
      { status: 500 },
    );
  }
}
