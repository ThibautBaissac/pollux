import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const MEMORY_DIR = join(process.cwd(), "data", "memory");
const MEMORY_PATH = join(MEMORY_DIR, "knowledge.md");

const DEFAULT_CONTENT = `# Knowledge Base

Add facts about yourself here. Pollux will use this information in every conversation.
`;

export function readMemory(): string {
  try {
    return readFileSync(MEMORY_PATH, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      mkdirSync(MEMORY_DIR, { recursive: true });
      writeFileSync(MEMORY_PATH, DEFAULT_CONTENT, "utf-8");
      return DEFAULT_CONTENT;
    }
    throw err;
  }
}

export function writeMemory(content: string): void {
  writeFileSync(MEMORY_PATH, content, "utf-8");
}
