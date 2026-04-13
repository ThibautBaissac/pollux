import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { countUnread, listExecutions } from "@/lib/executions";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({
    items: listExecutions(50),
    unreadCount: countUnread(),
  });
}
