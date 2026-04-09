import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

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
      toolUses: m.toolUses ? JSON.parse(m.toolUses) : null,
    })),
  });
}
