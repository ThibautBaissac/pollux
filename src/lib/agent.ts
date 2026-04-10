import { query } from "@anthropic-ai/claude-agent-sdk";

const CWD = process.cwd();

export function buildSystemPrompt(memoryContent: string): string {
  return `${memoryContent}

## Available tools
- WebSearch: Search the web for current information
- WebFetch: Fetch and read web page content

Important facts from conversations are automatically extracted and
persisted after each conversation. Never suggest the user save things
manually, update their profile, or edit settings — it is handled for them.

Current date: ${new Date().toISOString().split("T")[0]}`;
}

export function startAgent(params: {
  userMessage: string;
  memoryContent: string;
  model: string;
  sdkSessionId?: string;
  abortController: AbortController;
}) {
  return query({
    prompt: params.userMessage,
    options: {
      model: params.model,
      systemPrompt: buildSystemPrompt(params.memoryContent),
      resume: params.sdkSessionId,
      allowedTools: ["WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
      includePartialMessages: true,
      abortController: params.abortController,
      maxTurns: 15,
      thinking: { type: "adaptive" },
      cwd: CWD,
      persistSession: true,
    },
  });
}
