import { NextResponse } from "next/server";
import { validateSession, getPasswordHash, verifyPassword } from "@/lib/auth";

export async function requireAuth(): Promise<NextResponse | null> {
  const authenticated = await validateSession();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function requirePasswordConfirmation(
  currentPassword: unknown,
): Promise<NextResponse | null> {
  if (!currentPassword || typeof currentPassword !== "string") {
    return NextResponse.json(
      { error: "Current password is required" },
      { status: 400 },
    );
  }

  const hash = getPasswordHash();
  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  return null;
}
