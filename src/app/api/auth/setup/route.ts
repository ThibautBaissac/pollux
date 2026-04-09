import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/db/schema";
import { hashPassword, isSetupComplete, createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (isSetupComplete()) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { password } = body;

  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const hash = await hashPassword(password);

  db.insert(authConfig)
    .values({ key: "password_hash", value: hash })
    .run();

  await createSession();

  return NextResponse.json({ success: true });
}
