import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePasswordConfirmation,
} from "@/lib/auth-guard";
import { changePassword, destroyAllSessions, createSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitError = enforceRateLimit(request, {
    key: "auth:change-password",
    limit: 8,
    windowMs: 5 * 60 * 1000,
  });
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { currentPassword, newPassword } = parsed.data;

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
