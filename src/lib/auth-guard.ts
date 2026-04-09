import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";

export async function requireAuth(): Promise<NextResponse | null> {
  const authenticated = await validateSession();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
