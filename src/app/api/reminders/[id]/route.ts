import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import {
  SAFE_REMINDER_ERRORS,
  deleteReminder,
  getReminder,
  updateReminder,
  type ReminderUpdateFields,
} from "@/lib/reminders";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const reminder = getReminder(id);
  if (!reminder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(reminder);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const fields: ReminderUpdateFields = {};

  if (parsed.data.name !== undefined) {
    if (typeof parsed.data.name !== "string" || !parsed.data.name.trim()) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 },
      );
    }
    fields.name = parsed.data.name.trim().slice(0, 200);
  }

  if (parsed.data.message !== undefined) {
    if (typeof parsed.data.message !== "string" || !parsed.data.message.trim()) {
      return NextResponse.json(
        { error: "message must be a non-empty string" },
        { status: 400 },
      );
    }
    fields.message = parsed.data.message.trim().slice(0, 2000);
  }

  if (parsed.data.kind !== undefined) {
    if (parsed.data.kind !== "notify" && parsed.data.kind !== "agent") {
      return NextResponse.json(
        { error: "kind must be 'notify' or 'agent'" },
        { status: 400 },
      );
    }
    fields.kind = parsed.data.kind;
  }

  if (parsed.data.scheduleType !== undefined) {
    if (
      parsed.data.scheduleType !== "once" &&
      parsed.data.scheduleType !== "recurring"
    ) {
      return NextResponse.json(
        { error: "scheduleType must be 'once' or 'recurring'" },
        { status: 400 },
      );
    }
    fields.scheduleType = parsed.data.scheduleType;
  }

  if (parsed.data.cronExpr !== undefined) {
    if (typeof parsed.data.cronExpr !== "string") {
      return NextResponse.json(
        { error: "cronExpr must be a string" },
        { status: 400 },
      );
    }
    fields.cronExpr = parsed.data.cronExpr.trim();
  }

  if (parsed.data.scheduledAt !== undefined) {
    if (typeof parsed.data.scheduledAt !== "string") {
      return NextResponse.json(
        { error: "scheduledAt must be a string" },
        { status: 400 },
      );
    }
    fields.scheduledAt = parsed.data.scheduledAt.trim();
  }

  if (parsed.data.timezone !== undefined) {
    if (typeof parsed.data.timezone !== "string") {
      return NextResponse.json(
        { error: "timezone must be a string" },
        { status: 400 },
      );
    }
    fields.timezone = parsed.data.timezone.trim();
  }

  if (parsed.data.conversationId !== undefined) {
    if (
      typeof parsed.data.conversationId !== "string" ||
      !parsed.data.conversationId.trim()
    ) {
      return NextResponse.json(
        { error: "conversationId must be a non-empty string" },
        { status: 400 },
      );
    }
    fields.conversationId = parsed.data.conversationId.trim();
  }

  if (parsed.data.enabled !== undefined) {
    if (typeof parsed.data.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    fields.enabled = parsed.data.enabled;
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: "At least one field is required" },
      { status: 400 },
    );
  }

  try {
    const updated = updateReminder(id, fields);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err: unknown) {
    console.error("Failed to update reminder:", err);
    const raw = err instanceof Error ? err.message : "";
    const safe = SAFE_REMINDER_ERRORS.includes(raw)
      ? raw
      : "Failed to update reminder";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const deleted = deleteReminder(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
