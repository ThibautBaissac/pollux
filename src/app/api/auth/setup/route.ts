import { NextRequest, NextResponse } from "next/server";
import {
  isSetupComplete,
  createSession,
  setEmail,
  changePassword,
  generateRecoveryCodes,
  storeRecoveryCodes,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (isSetupComplete()) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { email, password } = body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  await changePassword(password);
  setEmail(email);

  const { codes, hashes } = await generateRecoveryCodes();
  storeRecoveryCodes(hashes);

  await createSession();

  return NextResponse.json({ success: true, recoveryCodes: codes });
}
