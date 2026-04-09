import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePasswordConfirmation,
} from "@/lib/auth-guard";
import { setEmail } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { currentPassword, email } = body;

  const pwError = await requirePasswordConfirmation(currentPassword);
  if (pwError) return pwError;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }

  setEmail(email);

  return NextResponse.json({ success: true });
}
