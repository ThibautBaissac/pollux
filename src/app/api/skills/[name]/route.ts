import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-config";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import { mapSkillError } from "@/lib/skill-http";
import {
  deleteSkill,
  readSkill,
  updateSkill,
  type UpdatePatch,
} from "@/lib/skills";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { name } = await params;
  const skill = readSkill(name);
  if (!skill) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    body: skill.body,
    supporting_files: skill.supportingFiles.map((f) => ({
      path: f.path,
      size_bytes: f.sizeBytes,
    })),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitError = enforceRateLimit(request, RATE_LIMITS.skillsMutate);
  if (rateLimitError) return rateLimitError;

  const { name } = await params;
  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const patch: UpdatePatch = {};

  if (parsed.data.description !== undefined) {
    if (typeof parsed.data.description !== "string") {
      return NextResponse.json(
        { error: "description must be a string" },
        { status: 400 },
      );
    }
    patch.description = parsed.data.description;
  }

  if (parsed.data.body !== undefined) {
    if (typeof parsed.data.body !== "string") {
      return NextResponse.json(
        { error: "body must be a string" },
        { status: 400 },
      );
    }
    patch.body = parsed.data.body;
  }

  if (parsed.data.tags !== undefined) {
    if (
      !Array.isArray(parsed.data.tags) ||
      !parsed.data.tags.every((t) => typeof t === "string")
    ) {
      return NextResponse.json(
        { error: "tags must be an array of strings" },
        { status: 400 },
      );
    }
    patch.tags = parsed.data.tags as string[];
  }

  if (
    patch.description === undefined &&
    patch.body === undefined &&
    patch.tags === undefined
  ) {
    return NextResponse.json(
      { error: "At least one of description, body, tags is required" },
      { status: 400 },
    );
  }

  try {
    updateSkill(name, patch);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return mapSkillError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitError = enforceRateLimit(request, RATE_LIMITS.skillsMutate);
  if (rateLimitError) return rateLimitError;

  const { name } = await params;
  try {
    const result = deleteSkill(name);
    return NextResponse.json({ ok: true, deleted: result.deleted });
  } catch (err: unknown) {
    return mapSkillError(err);
  }
}
