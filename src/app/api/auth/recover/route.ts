import { NextRequest, NextResponse } from "next/server";
import {
  verifyRecoveryCode,
  changePassword,
  destroyAllSessions,
  createSession,
  isSetupComplete,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!isSetupComplete()) {
    return NextResponse.json(
      { error: "Setup not complete" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { code, newPassword } = body;

  if (!code || typeof code !== "string") {
    return NextResponse.json(
      { error: "Recovery code is required" },
      { status: 400 },
    );
  }

  if (
    !newPassword ||
    typeof newPassword !== "string" ||
    newPassword.length < 8
  ) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const valid = await verifyRecoveryCode(code);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid or already used recovery code" },
      { status: 401 },
    );
  }

  await changePassword(newPassword);
  destroyAllSessions();
  await createSession();

  return NextResponse.json({ success: true });
}
