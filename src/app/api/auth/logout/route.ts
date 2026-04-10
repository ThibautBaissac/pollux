import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { requireAuth } from "@/lib/auth-guard";
import { requireTrustedRequest } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  await destroySession();

  return NextResponse.json({ success: true });
}
