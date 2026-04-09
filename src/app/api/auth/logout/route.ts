import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { requireAuth } from "@/lib/auth-guard";

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  await destroySession();

  return NextResponse.json({ success: true });
}
