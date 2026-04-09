import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, getPasswordHash, createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const hash = getPasswordHash();
  if (!hash) {
    return NextResponse.json(
      { error: "Setup not complete" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { password } = body;

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
