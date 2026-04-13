import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-config";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import { mapSkillError } from "@/lib/skill-http";
import { createSkill, walkSkills } from "@/lib/skills";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const { entries, diagnostics } = walkSkills();
  return NextResponse.json({ skills: entries, diagnostics });
}

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitError = enforceRateLimit(request, RATE_LIMITS.skillsMutate);
  if (rateLimitError) return rateLimitError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { name, description, body, tags } = parsed.data;

  if (typeof name !== "string") {
    return NextResponse.json(
      { error: "name must be a string" },
      { status: 400 },
    );
  }
  if (typeof description !== "string") {
    return NextResponse.json(
      { error: "description must be a string" },
      { status: 400 },
    );
  }
  if (typeof body !== "string") {
    return NextResponse.json(
      { error: "body must be a string" },
      { status: 400 },
    );
  }
  if (
    tags !== undefined &&
    (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))
  ) {
    return NextResponse.json(
      { error: "tags must be an array of strings" },
      { status: 400 },
    );
  }

  try {
    createSkill({
      name,
      description,
      body,
      tags: tags as string[] | undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return mapSkillError(err);
  }
}
