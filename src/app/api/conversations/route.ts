import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .all();

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}
