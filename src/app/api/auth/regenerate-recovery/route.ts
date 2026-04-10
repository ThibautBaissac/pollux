import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePasswordConfirmation,
} from "@/lib/auth-guard";
import { generateRecoveryCodes, storeRecoveryCodes } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitError = enforceRateLimit(request, {
    key: "auth:regenerate-recovery",
    limit: 8,
    windowMs: 5 * 60 * 1000,
  });
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { currentPassword } = parsed.data;

  const pwError = await requirePasswordConfirmation(currentPassword);
  if (pwError) return pwError;

  const { codes, hashes } = await generateRecoveryCodes();
  storeRecoveryCodes(hashes);

  return NextResponse.json({ success: true, recoveryCodes: codes });
}
