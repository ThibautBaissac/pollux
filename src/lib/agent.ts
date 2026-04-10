import { query } from "@anthropic-ai/claude-agent-sdk";
import { getCwd } from "@/lib/cwd-store";

export function buildSystemPrompt(
  memoryContent: string,
  cwd: string,
): string {
  return `${memoryContent}

## Available tools

### Web
- WebSearch: Search the web for current information
- WebFetch: Fetch and read web page content

### Filesystem
- Read: Read file contents (supports line offset/limit for large files)
- Write: Create or overwrite files
- Edit: Make targeted edits to existing files (find and replace)
- Glob: Find files by pattern (e.g. "src/**/*.ts")
- Grep: Search file contents with regex

Working directory: ${cwd}
Use relative paths when working within this directory.

### Filesystem guidelines
- NEVER read or output contents of .env, .env.*, *.pem, or *.key files
- Always Read a file before using Edit on it
- Prefer Edit over Write for modifying existing files

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
  const cwd = getCwd();

  return query({
    prompt: params.userMessage,
    options: {
      model: params.model,
      systemPrompt: buildSystemPrompt(params.memoryContent, cwd),
      resume: params.sdkSessionId,
      allowedTools: [
        "WebSearch",
        "WebFetch",
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
      ],
      permissionMode: "dontAsk",
      includePartialMessages: true,
      abortController: params.abortController,
      maxTurns: 15,
      thinking: { type: "adaptive" },
      cwd,
      persistSession: true,
    },
  });
}
