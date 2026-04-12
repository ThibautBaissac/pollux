import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePasswordConfirmation,
} from "@/lib/auth-guard";
import { generateRecoveryCodes, storeRecoveryCodes } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-config";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitError = enforceRateLimit(request, RATE_LIMITS.regenerateRecovery);
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { currentPassword } = parsed.data;

  const pwError = await requirePasswordConfirmation(currentPassword);
  if (pwError) return pwError;

  const { codes, entries } = await generateRecoveryCodes();
  storeRecoveryCodes(entries);

  return NextResponse.json({ success: true, recoveryCodes: codes });
}
