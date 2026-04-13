import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMemory } from "@/lib/memory";
import { startAgent } from "@/lib/agent";
import { getModel } from "@/lib/model-store";
import type { ToolUse } from "@/types";

// ---------------------------------------------------------------------------
// Conversation resolution
// ---------------------------------------------------------------------------

export interface ResolvedConversation {
  convId: string;
  sdkSessionId: string | undefined;
  title: string;
}

export function resolveConversation(
  inputConvId: string | undefined,
  createIfMissing: boolean,
  messageText: string,
): ResolvedConversation | { error: string; status: number } {
  const title = messageText.slice(0, 60);

  if (inputConvId) {
    const conv = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, inputConvId))
      .get();

    if (!conv && !createIfMissing) {
      return { error: "Conversation not found", status: 404 };
    }

    if (conv) {
      return {
        convId: inputConvId,
        sdkSessionId: conv.sdkSessionId ?? undefined,
        title,
      };
    }

    const now = new Date();
    db.insert(conversations)
      .values({ id: inputConvId, title, createdAt: now, updatedAt: now })
      .run();
    return { convId: inputConvId, sdkSessionId: undefined, title };
  }

  const convId = crypto.randomUUID();
  const now = new Date();
  db.insert(conversations)
    .values({ id: convId, title, createdAt: now, updatedAt: now })
    .run();
  return { convId, sdkSessionId: undefined, title };
}

// ---------------------------------------------------------------------------
// Message persistence
// ---------------------------------------------------------------------------

export function persistUserMessage(convId: string, content: string): void {
  const now = new Date();
  db.insert(messages)
    .values({
      id: crypto.randomUUID(),
      conversationId: convId,
      role: "user",
      content,
      createdAt: now,
    })
    .run();
  db.update(conversations)
    .set({ updatedAt: now })
    .where(eq(conversations.id, convId))
    .run();
}

export function persistAssistantMessage(
  convId: string,
  content: string,
  toolUses: ToolUse[] | null,
): string {
  const now = new Date();
  const id = crypto.randomUUID();
  db.insert(messages)
    .values({
      id,
      conversationId: convId,
      role: "assistant",
      content,
      toolUses:
        toolUses && toolUses.length > 0 ? JSON.stringify(toolUses) : null,
      createdAt: now,
    })
    .run();
  db.update(conversations)
    .set({ updatedAt: now })
    .where(eq(conversations.id, convId))
    .run();
  return id;
}

// ---------------------------------------------------------------------------
// Chat stream
// ---------------------------------------------------------------------------

export interface ChatStreamParams {
  convId: string;
  sdkSessionId: string | undefined;
  title: string;
  message: string;
  abortSignal: AbortSignal;
}

export function createChatStream(params: ChatStreamParams): ReadableStream {
  const { convId, message, title, abortSignal } = params;
  const memoryContent = readMemory();
  const model = getModel();

  const controller = new AbortController();
  abortSignal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  return new ReadableStream({
    async start(streamController) {
      const encoder = new TextEncoder();
      let closed = false;

      function emit(event: string, data: object) {
        if (closed) return;
        streamController.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      emit("init", { conversationId: convId, sessionId: "", title });

      let partialText = "";
      let pendingToolUses: ToolUse[] = [];
      let currentSessionId = params.sdkSessionId;
      let deltasEmitted = false;
      let attempts = 0;

      while (attempts < 2) {
        attempts++;
        try {
          const agentStream = startAgent({
            userMessage: message,
            memoryContent,
            model,
            sdkSessionId: currentSessionId,
            conversationId: convId,
            abortController: controller,
          });

          for await (const msg of agentStream) {
            if (abortSignal.aborted) break;

            if (msg.type === "system" && msg.subtype === "init") {
              currentSessionId = msg.session_id;
              db.update(conversations)
                .set({ sdkSessionId: msg.session_id })
                .where(eq(conversations.id, convId))
                .run();
              emit("init", {
                conversationId: convId,
                sessionId: msg.session_id,
                title,
              });
            } else if (msg.type === "stream_event") {
              const event = msg.event;
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                partialText += event.delta.text;
                deltasEmitted = true;
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
                  input:
                    "input" in block && block.input
                      ? (block.input as Record<string, unknown>)
                      : undefined,
                }));

              if (fullText) {
                const allToolUses =
                  pendingToolUses.length > 0
                    ? [...pendingToolUses, ...toolUses]
                    : toolUses;
                persistAssistantMessage(
                  convId,
                  fullText,
                  allToolUses.length > 0 ? allToolUses : null,
                );
                pendingToolUses = [];
              } else if (toolUses.length > 0) {
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

          if (abortSignal.aborted) {
            if (partialText.trim()) {
              persistAssistantMessage(
                convId,
                partialText,
                pendingToolUses.length > 0 ? pendingToolUses : null,
              );
            }
            break;
          }

          break;
        } catch (err: unknown) {
          const isAbort =
            (err instanceof Error && err.name === "AbortError") ||
            abortSignal.aborted;

          if (isAbort) {
            if (partialText.trim()) {
              persistAssistantMessage(
                convId,
                partialText,
                pendingToolUses.length > 0 ? pendingToolUses : null,
              );
            }
            break;
          }

          if (currentSessionId && attempts < 2 && !deltasEmitted) {
            db.update(conversations)
              .set({ sdkSessionId: null })
              .where(eq(conversations.id, convId))
              .run();
            currentSessionId = undefined;
            partialText = "";
            pendingToolUses = [];
            deltasEmitted = false;
            continue;
          }

          console.error("Chat stream failed:", err);
          if (partialText.trim()) {
            persistAssistantMessage(
              convId,
              partialText,
              pendingToolUses.length > 0 ? pendingToolUses : null,
            );
          }
          emit("error", { message: "Unable to complete the request" });
          break;
        }
      }

      closed = true;
      streamController.close();
    },
  });
}
