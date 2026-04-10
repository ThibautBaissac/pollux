import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

function escapeLike(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 200);
  if (!q) {
    return NextResponse.json([]);
  }

  const pattern = `%${escapeLike(q)}%`;

  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      sql`(${conversations.title} LIKE ${pattern} ESCAPE '\\' OR ${conversations.id} IN (SELECT ${messages.conversationId} FROM ${messages} WHERE ${messages.content} LIKE ${pattern} ESCAPE '\\'))`,
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(50)
    .all();

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}
