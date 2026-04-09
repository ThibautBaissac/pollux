import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePasswordConfirmation,
} from "@/lib/auth-guard";
import { changePassword, destroyAllSessions, createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { currentPassword, newPassword } = body;

  const pwError = await requirePasswordConfirmation(currentPassword);
  if (pwError) return pwError;

  if (
    !newPassword ||
    typeof newPassword !== "string" ||
    newPassword.length < 8
  ) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 },
    );
  }

  await changePassword(newPassword);
  destroyAllSessions();
  await createSession();

  return NextResponse.json({ success: true });
}
