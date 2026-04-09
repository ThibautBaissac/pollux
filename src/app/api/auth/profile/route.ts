import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getEmail } from "@/lib/auth";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({ email: getEmail() });
}
