import { NextRequest, NextResponse } from "next/server";
import {
  verifyRecoveryCode,
  changePassword,
  destroyAllSessions,
  createSession,
  isSetupComplete,
} from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  if (!isSetupComplete()) {
    return NextResponse.json(
      { error: "Setup not complete" },
      { status: 400 },
    );
  }

  const rateLimitError = enforceRateLimit(request, {
    key: "auth:recover",
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { code, newPassword } = parsed.data;

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
