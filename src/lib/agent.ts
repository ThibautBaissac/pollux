import { query } from "@anthropic-ai/claude-agent-sdk";
import { getCwd } from "@/lib/cwd-store";
import { getMcpServers } from "@/lib/mcp-store";
import {
  REMINDER_MCP_SERVER_NAME,
  REMINDER_MCP_TOOL_NAME,
  reminderMcpServer,
} from "@/lib/reminder-tool";

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

const REMINDER_ALLOWED_TOOL = `mcp__${REMINDER_MCP_SERVER_NAME}__${REMINDER_MCP_TOOL_NAME}`;

function buildUserPrompt(userMessage: string, conversationId?: string): string {
  if (!conversationId) return userMessage;

  return `${userMessage}

<system-reminder>
Current conversation ID: ${conversationId}
When using the reminder tool for this conversation, pass this exact value as conversationId.
</system-reminder>`;
}

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

### Reminders
- reminder: Create, list, edit, or delete scheduled reminders for the user
  - add: requires name, message, scheduleType ("once" or "recurring"), conversationId (use the current conversation ID), and either cronExpr (5-field cron, e.g. "0 15 * * 5" = Friday 3 PM) or scheduledAt (ISO 8601 datetime). Optional: timezone (IANA, e.g. "America/New_York"), kind.
  - edit: update an existing reminder by reminderId. You can change name, message, kind, scheduleType, cronExpr, scheduledAt, timezone, conversationId, and enabled. If switching scheduleType, provide the matching schedule field.
  - kind: "notify" (default) posts the message as a static reminder in the conversation. "agent" executes the message as a prompt (veille / automated monitoring) — use this for recurring research tasks like "check latest AI news every Monday 8am".
  - list: show all reminders with schedule, status, and next run time
  - remove: delete a reminder by reminderId
When the user asks to set, update, or schedule a reminder or veille, use this tool. The conversationId is the ID of the current conversation — it will be provided in the user message context.

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
  conversationId?: string;
  abortController: AbortController;
}) {
  const cwd = getCwd();
  const userMcpServers = getMcpServers();
  const mcpServers = {
    [REMINDER_MCP_SERVER_NAME]: reminderMcpServer,
    ...userMcpServers,
  };

  return query({
    prompt: buildUserPrompt(params.userMessage, params.conversationId),
    options: {
      model: params.model,
      systemPrompt: buildSystemPrompt(params.memoryContent, cwd),
      resume: params.sdkSessionId,
      allowedTools: [...ALLOWED_TOOLS, REMINDER_ALLOWED_TOOL],
      agents: AGENTS,
      permissionMode: "dontAsk",
      includePartialMessages: true,
      abortController: params.abortController,
      maxTurns: 15,
      thinking: { type: "adaptive" },
      cwd,
      persistSession: true,
      mcpServers,
    },
  });
}
