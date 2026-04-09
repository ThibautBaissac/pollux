import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMemory } from "@/lib/memory";
import { startAgent } from "@/lib/agent";
import type { ToolUse } from "@/types";

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { conversationId: inputConvId, message } = body as {
    conversationId?: string;
    message?: string;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Load or create conversation
  let convId = inputConvId;
  let sdkSessionId: string | undefined;

  if (convId) {
    const conv = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .get();
    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    sdkSessionId = conv.sdkSessionId ?? undefined;
  } else {
    convId = crypto.randomUUID();
    const now = new Date();
    db.insert(conversations)
      .values({
        id: convId,
        title: message.slice(0, 60),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // Insert user message
  db.insert(messages)
    .values({
      id: crypto.randomUUID(),
      conversationId: convId,
      role: "user",
      content: message,
      createdAt: new Date(),
    })
    .run();

  const memoryContent = readMemory();

  // Wire abort to request signal
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const finalConvId = convId;

  const stream = new ReadableStream({
    async start(streamController) {
      const encoder = new TextEncoder();
      function emit(event: string, data: object) {
        streamController.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      function persistAssistantMessage(
        content: string,
        toolUses: ToolUse[] | null,
      ) {
        db.insert(messages)
          .values({
            id: crypto.randomUUID(),
            conversationId: finalConvId,
            role: "assistant",
            content,
            toolUses: toolUses && toolUses.length > 0
              ? JSON.stringify(toolUses)
              : null,
            createdAt: new Date(),
          })
          .run();
        db.update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, finalConvId))
          .run();
      }

      // Emit init immediately before SDK call
      emit("init", { conversationId: finalConvId, sessionId: "" });

      let partialText = "";
      // Tool uses from assistant frames with no text (tool-call-only turns).
      // Merged into the next text-containing assistant message.
      let pendingToolUses: ToolUse[] = [];
      let currentSessionId = sdkSessionId;
      let attempts = 0;

      while (attempts < 2) {
        attempts++;
        try {
          const agentStream = startAgent({
            userMessage: message,
            memoryContent,
            sdkSessionId: currentSessionId,
            abortController: controller,
          });

          for await (const msg of agentStream) {
            if (request.signal.aborted) break;

            if (msg.type === "system" && msg.subtype === "init") {
              db.update(conversations)
                .set({ sdkSessionId: msg.session_id })
                .where(eq(conversations.id, finalConvId))
                .run();
              emit("init", {
                conversationId: finalConvId,
                sessionId: msg.session_id,
              });
            } else if (msg.type === "stream_event") {
              const event = msg.event;
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                partialText += event.delta.text;
                emit("delta", { text: event.delta.text });
              }
            } else if (msg.type === "assistant") {
              const fullText = msg.message.content
                .filter((block) => block.type === "text")
                .map((block) =>
                  "text" in block ? (block.text as string) : "",
                )
                .join("");

              const toolUses = msg.message.content
                .filter((block) => block.type === "tool_use")
                .map((block) => ({
                  name: "name" in block ? (block.name as string) : "unknown",
                }));

              if (fullText) {
                // Merge any pending tool uses from prior tool-only frames
                const allToolUses =
                  pendingToolUses.length > 0
                    ? [...pendingToolUses, ...toolUses]
                    : toolUses;
                persistAssistantMessage(
                  fullText,
                  allToolUses.length > 0 ? allToolUses : null,
                );
                pendingToolUses = [];
              } else if (toolUses.length > 0) {
                // Tool-only frame — defer, don't persist an empty row
                pendingToolUses.push(...toolUses);
              }

              partialText = "";
            } else if (msg.type === "tool_progress") {
              emit("tool", {
                name: msg.tool_name,
                status: "running",
                elapsed: msg.elapsed_time_seconds,
              });
            } else if (msg.type === "result") {
              emit("done", {
                costUsd: msg.total_cost_usd,
                turns: msg.num_turns,
              });
            }
          }

          // Success — exit retry loop
          break;
        } catch (err: unknown) {
          const isAbort =
            (err instanceof Error && err.name === "AbortError") ||
            request.signal.aborted;

          if (isAbort) {
            if (partialText.trim()) {
              persistAssistantMessage(partialText, null);
            }
            break;
          }

          // If we had a session ID and haven't retried yet, the resume
          // may have failed (corrupted SDK session). Clear it and retry.
          if (currentSessionId && attempts < 2) {
            db.update(conversations)
              .set({ sdkSessionId: null })
              .where(eq(conversations.id, finalConvId))
              .run();
            currentSessionId = undefined;
            partialText = "";
            pendingToolUses = [];
            continue;
          }

          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          emit("error", { message: errorMessage });
          break;
        }
      }

      streamController.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
