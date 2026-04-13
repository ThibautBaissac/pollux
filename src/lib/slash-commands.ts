export type SlashCommandName = "new" | "stop" | "status" | "dream" | "skills";

export interface SlashCommand {
  name: SlashCommandName;
}

export interface SlashCommandDef {
  name: SlashCommandName;
  description: string;
}

export const COMMAND_DEFS: readonly SlashCommandDef[] = [
  { name: "new", description: "Start a fresh conversation" },
  { name: "stop", description: "Stop the current response" },
  { name: "status", description: "Show model, conversation, and last cost" },
  { name: "dream", description: "Run memory consolidation now" },
  { name: "skills", description: "Open the skills manager" },
];

export const COMMANDS: SlashCommandName[] = COMMAND_DEFS.map((c) => c.name);

export function parseCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const name = trimmed.slice(1).toLowerCase();
  if ((COMMANDS as string[]).includes(name)) {
    return { name: name as SlashCommandName };
  }
  return null;
}

export function getCommandSuggestions(text: string): SlashCommandDef[] {
  if (!text.startsWith("/")) return [];
  if (/\s/.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  return COMMAND_DEFS.filter((c) => c.name.startsWith(query));
}
