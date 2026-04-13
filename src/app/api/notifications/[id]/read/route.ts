import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { requireTrustedRequest } from "@/lib/request-guards";
import { markRead } from "@/lib/executions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  if (!markRead(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
