import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { readJsonObject, requireTrustedRequest } from "@/lib/request-guards";
import {
  resolveConversation,
  persistUserMessage,
  createChatStream,
} from "@/lib/chat";

export async function POST(request: NextRequest) {
  const requestError = requireTrustedRequest(request);
  if (requestError) return requestError;

  const authError = await requireAuth();
  if (authError) return authError;

  const parsed = await readJsonObject(request);
  if (parsed.response) return parsed.response;

  const rawConversationId = parsed.data.conversationId;
  const rawMessage = parsed.data.message;
  const rawCreateIfMissing = parsed.data.createIfMissing;

  if (
    rawConversationId !== undefined &&
    typeof rawConversationId !== "string"
  ) {
    return NextResponse.json(
      { error: "Conversation ID must be a string" },
      { status: 400 },
    );
  }

  if (
    rawCreateIfMissing !== undefined &&
    typeof rawCreateIfMissing !== "boolean"
  ) {
    return NextResponse.json(
      { error: "createIfMissing must be a boolean" },
      { status: 400 },
    );
  }

  if (typeof rawMessage !== "string" || !rawMessage.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const result = resolveConversation(
    rawConversationId,
    rawCreateIfMissing === true,
    rawMessage,
  );

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  persistUserMessage(result.convId, rawMessage);

  const stream = createChatStream({
    convId: result.convId,
    sdkSessionId: result.sdkSessionId,
    title: result.title,
    message: rawMessage,
    abortSignal: request.signal,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
