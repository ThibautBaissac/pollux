import { NextRequest, NextResponse } from "next/server";
import {
  isSetupComplete,
  createSession,
  performFirstTimeSetup,
  generateRecoveryCodes,
  storeRecoveryCodes,
} from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-config";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  if (isSetupComplete()) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 400 },
    );
  }

  const rateLimitError = enforceRateLimit(request, RATE_LIMITS.setup);
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { email, password } = parsed.data;

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

  const didSetup = await performFirstTimeSetup(email, password);
  if (!didSetup) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 400 },
    );
  }

  const { codes, hashes } = await generateRecoveryCodes();
  storeRecoveryCodes(hashes);

  await createSession();

  return NextResponse.json({ success: true, recoveryCodes: codes });
}
