import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import { AVAILABLE_MODELS, isValidModel } from "@/lib/models";
import { getModel, setModel } from "@/lib/model-store";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({ model: getModel() });
}

export async function PUT(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { model } = parsed.data;

  if (typeof model !== "string" || !isValidModel(model)) {
    return NextResponse.json(
      {
        error: `Invalid model. Must be one of: ${AVAILABLE_MODELS.map((m) => m.id).join(", ")}`,
      },
      { status: 400 },
    );
  }

  setModel(model);
  return NextResponse.json({ model });
}
