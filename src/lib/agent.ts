import { query } from "@anthropic-ai/claude-agent-sdk";

const CWD = process.cwd();

export function buildSystemPrompt(memoryContent: string): string {
  return `You are Pollux, a personal AI assistant.
You are helpful, direct, and concise. You remember context from the
user's knowledge base (provided below) and use tools when helpful.

## Available tools
- WebSearch: Search the web for current information
- WebFetch: Fetch and read web page content

## Knowledge base
${memoryContent}

Current date: ${new Date().toISOString().split("T")[0]}`;
}

export function startAgent(params: {
  userMessage: string;
  memoryContent: string;
  sdkSessionId?: string;
  abortController: AbortController;
}) {
  return query({
    prompt: params.userMessage,
    options: {
      model: "claude-sonnet-4-6",
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
