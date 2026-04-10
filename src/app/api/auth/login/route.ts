import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, getPasswordHash, createSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const hash = getPasswordHash();
  if (!hash) {
    return NextResponse.json(
      { error: "Setup not complete" },
      { status: 400 },
    );
  }

  const rateLimitError = enforceRateLimit(request, {
    key: "auth:login",
    limit: 10,
    windowMs: 5 * 60 * 1000,
  });
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { password } = parsed.data;

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: "Password is required" },
      { status: 400 },
    );
  }

  const valid = await verifyPassword(password, hash);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid password" },
      { status: 401 },
    );
  }

  await createSession();

  return NextResponse.json({ success: true });
}
