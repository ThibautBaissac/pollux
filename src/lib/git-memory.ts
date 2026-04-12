import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { MEMORY_DIR } from "./memory";

const TRACKED_FILES = ["profile.md", "knowledge.md"];

function gitSilent(args: string[]): void {
  execFileSync("git", ["-C", MEMORY_DIR, ...args], { stdio: "ignore" });
}

function gitCapture(args: string[]): string {
  return execFileSync("git", ["-C", MEMORY_DIR, ...args], {
    encoding: "utf-8",
  });
}

export async function gitCommitMemory(
  timestamp: string,
): Promise<string | null> {
  try {
    const status = gitCapture([
      "status",
      "--porcelain",
      ...TRACKED_FILES,
    ]).trim();

    if (!status) return null;

    for (const f of TRACKED_FILES) {
      gitSilent(["add", f]);
    }
    gitSilent([
      "commit",
      "-m",
      `dream: ${timestamp}`,
      "--author=pollux <pollux@local>",
    ]);

    return gitCapture(["rev-parse", "--short", "HEAD"]).trim();
  } catch (err) {
    console.error("git-memory: commit failed:", err);
    return null;
  }
}

export function initMemoryGit(): void {
  try {
    gitSilent(["rev-parse", "--git-dir"]);
  } catch {
    try {
      execFileSync("git", ["init", MEMORY_DIR], { stdio: "ignore" });
      const ignore = "*\n!profile.md\n!knowledge.md\n!.gitignore\n";
      writeFileSync(join(MEMORY_DIR, ".gitignore"), ignore);
      gitSilent(["add", ".gitignore"]);
      gitSilent([
        "commit",
        "-m",
        "init: pollux memory store",
        "--author=pollux <pollux@local>",
      ]);
    } catch (err) {
      console.error("git-memory: init failed:", err);
    }
  }
}
