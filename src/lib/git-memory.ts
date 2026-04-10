import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { MEMORY_DIR } from "./memory";

const TRACKED_FILES = ["profile.md", "knowledge.md"];

export async function gitCommitMemory(
  timestamp: string,
): Promise<string | null> {
  try {
    const status = execSync(
      `git -C "${MEMORY_DIR}" status --porcelain ${TRACKED_FILES.join(" ")}`,
      { encoding: "utf-8" },
    ).trim();

    if (!status) return null;

    for (const f of TRACKED_FILES) {
      execSync(`git -C "${MEMORY_DIR}" add "${f}"`, { stdio: "ignore" });
    }
    execSync(
      `git -C "${MEMORY_DIR}" commit -m "dream: ${timestamp}" --author="pollux <pollux@local>"`,
      { encoding: "utf-8" },
    );

    return execSync(`git -C "${MEMORY_DIR}" rev-parse --short HEAD`, {
      encoding: "utf-8",
    }).trim();
  } catch (err) {
    console.error("git-memory: commit failed:", err);
    return null;
  }
}

export function initMemoryGit(): void {
  try {
    execSync(`git -C "${MEMORY_DIR}" rev-parse --git-dir`, {
      stdio: "ignore",
    });
  } catch {
    try {
      execSync(`git init "${MEMORY_DIR}"`, { stdio: "ignore" });
      const ignore = "*\n!profile.md\n!knowledge.md\n!.gitignore\n";
      writeFileSync(join(MEMORY_DIR, ".gitignore"), ignore);
      execSync(`git -C "${MEMORY_DIR}" add .gitignore`, { stdio: "ignore" });
      execSync(
        `git -C "${MEMORY_DIR}" commit -m "init: pollux memory store" --author="pollux <pollux@local>"`,
        { stdio: "ignore" },
      );
    } catch (err) {
      console.error("git-memory: init failed:", err);
    }
  }
}
