import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

function safeParseToolUses(raw: string): unknown[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;

  const conv = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();

  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const msgs = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt))
    .all();

  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    updatedAt: conv.updatedAt.toISOString(),
    messages: msgs.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      toolUses: m.toolUses ? safeParseToolUses(m.toolUses) : null,
    })),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;

  const { changes } = db
    .delete(conversations)
    .where(eq(conversations.id, id))
    .run();

  if (changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { title } = parsed.data;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const trimmedTitle = title.trim().slice(0, 100);
  const now = new Date();

  const { changes } = db
    .update(conversations)
    .set({ title: trimmedTitle, updatedAt: now })
    .where(eq(conversations.id, id))
    .run();

  if (changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id,
    title: trimmedTitle,
    updatedAt: now.toISOString(),
  });
}
