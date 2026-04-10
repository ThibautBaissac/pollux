import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import { getReminder, updateReminder, deleteReminder } from "@/lib/reminders";

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

  const fields: { name?: string; message?: string; enabled?: boolean } = {};

  if (parsed.data.name !== undefined) {
    if (typeof parsed.data.name !== "string" || !parsed.data.name.trim()) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    fields.name = parsed.data.name.trim().slice(0, 200);
  }

  if (parsed.data.message !== undefined) {
    if (typeof parsed.data.message !== "string" || !parsed.data.message.trim()) {
      return NextResponse.json({ error: "message must be a non-empty string" }, { status: 400 });
    }
    fields.message = parsed.data.message.trim().slice(0, 2000);
  }

  if (parsed.data.enabled !== undefined) {
    if (typeof parsed.data.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    fields.enabled = parsed.data.enabled;
  }

  const updated = updateReminder(id, fields);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
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
