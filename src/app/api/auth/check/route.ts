import { NextResponse } from "next/server";
import { validateSession, isSetupComplete } from "@/lib/auth";

export async function GET() {
  const setupComplete = isSetupComplete();
  const authenticated = setupComplete ? await validateSession() : false;

  return NextResponse.json({
    authenticated,
    setupRequired: !setupComplete,
  });
}
