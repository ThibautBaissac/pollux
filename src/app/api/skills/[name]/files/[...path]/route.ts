import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { mapSkillError } from "@/lib/skill-http";
import { readSkill, readSupportingFile } from "@/lib/skills";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { name, path } = await params;

  if (!readSkill(name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const relPath = path.join("/");

  try {
    const content = readSupportingFile(name, relPath);
    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: unknown) {
    return mapSkillError(err);
  }
}
