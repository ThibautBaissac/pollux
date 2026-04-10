import { query } from "@anthropic-ai/claude-agent-sdk";
import { getCwd } from "@/lib/cwd-store";
import { getMcpServers } from "@/lib/mcp-store";

const ALLOWED_TOOLS: string[] = [
  "WebSearch",
  "WebFetch",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
];

const AGENTS = {
  researcher: {
    description: "Delegate web research and information gathering tasks",
    prompt:
      "You are a research assistant. Find information, summarize findings, and report back concisely.",
    tools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep"],
    maxTurns: 10,
  },
  coder: {
    description: "Delegate code exploration, editing, and shell command tasks",
    prompt:
      "You are a coding assistant. Read, search, edit code and run commands. Report what you did and the results.",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    maxTurns: 10,
  },
};

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

### Shell
- Bash: Run shell commands in the working directory

### Shell guidelines
- Avoid destructive commands (rm -rf /, shutdown, reboot, mkfs, dd)
- Prefer non-interactive commands — no vim, less, top, or interactive prompts
- Keep output concise — pipe through head/tail/grep when full output is not needed

### Subagents
You can delegate tasks to specialized subagents that work in parallel:
- researcher: Web research and information gathering
- coder: Code exploration, editing, and running shell commands
Use subagents when a task benefits from focused, parallel work.

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
  const mcpServers = getMcpServers();
  const hasMcp = Object.keys(mcpServers).length > 0;

  return query({
    prompt: params.userMessage,
    options: {
      model: params.model,
      systemPrompt: buildSystemPrompt(params.memoryContent, cwd),
      resume: params.sdkSessionId,
      allowedTools: [...ALLOWED_TOOLS],
      agents: AGENTS,
      permissionMode: "dontAsk",
      includePartialMessages: true,
      abortController: params.abortController,
      maxTurns: 15,
      thinking: { type: "adaptive" },
      cwd,
      persistSession: true,
      ...(hasMcp && { mcpServers }),
    },
  });
}
