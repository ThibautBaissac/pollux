import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import { listReminders, createReminder } from "@/lib/reminders";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json(listReminders());
}

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const { name, message, kind, scheduleType, cronExpr, scheduledAt, timezone, conversationId } =
    parsed.data;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (kind !== undefined && kind !== "notify" && kind !== "agent") {
    return NextResponse.json(
      { error: "kind must be 'notify' or 'agent'" },
      { status: 400 },
    );
  }
  if (scheduleType !== "once" && scheduleType !== "recurring") {
    return NextResponse.json(
      { error: "scheduleType must be 'once' or 'recurring'" },
      { status: 400 },
    );
  }
  if (typeof conversationId !== "string" || !conversationId.trim()) {
    return NextResponse.json(
      { error: "conversationId is required" },
      { status: 400 },
    );
  }

  if (scheduleType === "recurring") {
    if (typeof cronExpr !== "string" || !cronExpr.trim()) {
      return NextResponse.json(
        { error: "cronExpr is required for recurring reminders" },
        { status: 400 },
      );
    }
  } else {
    if (typeof scheduledAt !== "string" || !scheduledAt.trim()) {
      return NextResponse.json(
        { error: "scheduledAt is required for one-time reminders" },
        { status: 400 },
      );
    }
    if (isNaN(new Date(scheduledAt).getTime())) {
      return NextResponse.json(
        { error: "scheduledAt must be a valid ISO 8601 datetime" },
        { status: 400 },
      );
    }
  }

  if (timezone !== undefined && typeof timezone !== "string") {
    return NextResponse.json(
      { error: "timezone must be a string" },
      { status: 400 },
    );
  }

  try {
    const reminder = createReminder({
      name: name.trim().slice(0, 200),
      message: message.trim().slice(0, 2000),
      kind: kind as "notify" | "agent" | undefined,
      scheduleType,
      cronExpr: cronExpr as string | undefined,
      scheduledAt: scheduledAt as string | undefined,
      timezone: timezone as string | undefined,
      conversationId,
    });
    return NextResponse.json(reminder, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create reminder";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
