import { NextResponse } from "next/server";
import {
  SkillExistsError,
  SkillForbiddenError,
  SkillIOError,
  SkillNotFoundError,
  SkillPayloadTooLargeError,
  SkillValidationError,
} from "@/lib/skills";

export function mapSkillError(err: unknown): NextResponse {
  if (err instanceof SkillExistsError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof SkillPayloadTooLargeError) {
    return NextResponse.json({ error: err.message }, { status: 413 });
  }
  if (err instanceof SkillForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof SkillNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof SkillValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof SkillIOError) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  console.error("Unexpected skills error:", err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
