import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { requireTrustedRequest } from "@/lib/request-guards";
import { runDream, DreamAlreadyRunningError } from "@/lib/dream";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const start = Date.now();
  try {
    const result = await runDream();
    return NextResponse.json({
      summarized: result.summarized,
      edited: result.edited,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    if (err instanceof DreamAlreadyRunningError) {
      return NextResponse.json(
        { error: "Dream is already running" },
        { status: 409 },
      );
    }
    console.error("Manual /dream failed:", err);
    return NextResponse.json(
      { error: "Dream run failed" },
      { status: 500 },
    );
  }
}
