import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth-guard";
import { destroyAllSessions } from "@/lib/auth";

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  destroyAllSessions();
  const cookieStore = await cookies();
  cookieStore.delete("session");

  return NextResponse.json({ success: true });
}
