import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMemory } from "@/lib/memory";
import { startAgent } from "@/lib/agent";
import { getModel } from "@/lib/model-store";
import {
  persistUserMessage,
  persistAssistantMessage,
} from "@/lib/chat";
import { clearRunningFlag } from "@/lib/reminders";
import type { Reminder, ToolUse } from "@/types";

const RUN_TIMEOUT_MS = 5 * 60 * 1000;

export async function runScheduledAgent(reminder: Reminder): Promise<void> {
  const convId = reminder.conversationId;

  const conv = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, convId))
    .get();
  if (!conv) {
    console.error({
      event: "veille_failed",
      reminderId: reminder.id,
      reason: "conversation_missing",
    });
    clearRunningFlag(reminder.id);
    return;
  }

  persistUserMessage(convId, reminder.message);

  const memoryContent = readMemory();
  const model = getModel();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), RUN_TIMEOUT_MS);

  let pendingToolUses: ToolUse[] = [];
  let sawAssistantText = false;

  try {
    const agentStream = startAgent({
      userMessage: reminder.message,
      memoryContent,
      model,
      sdkSessionId: conv.sdkSessionId ?? undefined,
      conversationId: convId,
      abortController,
    });

    for await (const msg of agentStream) {
      if (abortController.signal.aborted) break;

      if (msg.type === "system" && msg.subtype === "init") {
        db.update(conversations)
          .set({ sdkSessionId: msg.session_id })
          .where(eq(conversations.id, convId))
          .run();
      } else if (msg.type === "assistant") {
        const fullText = msg.message.content
          .filter((block) => block.type === "text")
          .map((block) => ("text" in block ? (block.text as string) : ""))
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
          sawAssistantText = true;
        } else if (toolUses.length > 0) {
          pendingToolUses.push(...toolUses);
        }
      } else if (msg.type === "result") {
        console.log({
          event: "veille_done",
          reminderId: reminder.id,
          costUsd: msg.total_cost_usd,
          turns: msg.num_turns,
        });
      }
    }

    if (!sawAssistantText && pendingToolUses.length === 0) {
      persistAssistantMessage(
        convId,
        "⚠️ Veille produced no output.",
        null,
      );
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error({
      event: "veille_failed",
      reminderId: reminder.id,
      reason,
    });
    persistAssistantMessage(convId, `⚠️ Veille failed: ${reason}`, null);
  } finally {
    clearTimeout(timeoutId);
    clearRunningFlag(reminder.id);
  }
}
