export type Section =
  | "memory"
  | "model"
  | "working-directory"
  | "mcp-servers"
  | "reminders"
  | "skills"
  | "email"
  | "password"
  | "security";

export const SECTION_KEYS: readonly Section[] = [
  "memory",
  "model",
  "working-directory",
  "mcp-servers",
  "reminders",
  "skills",
  "email",
  "password",
  "security",
];
