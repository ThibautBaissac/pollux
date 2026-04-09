import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePasswordConfirmation,
} from "@/lib/auth-guard";
import { generateRecoveryCodes, storeRecoveryCodes } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { currentPassword } = body;

  const pwError = await requirePasswordConfirmation(currentPassword);
  if (pwError) return pwError;

  const { codes, hashes } = await generateRecoveryCodes();
  storeRecoveryCodes(hashes);

  return NextResponse.json({ success: true, recoveryCodes: codes });
}
