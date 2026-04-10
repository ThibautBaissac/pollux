import { existsSync, statSync } from "fs";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const KEY = "workingDirectory";

let cached: string | null = null;

export function getCwd(): string {
  if (cached !== null && existsSync(cached)) return cached;
  cached = null;

  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, KEY))
    .get();

  const stored = row?.value;
  if (stored && existsSync(stored) && statSync(stored).isDirectory()) {
    cached = stored;
    return stored;
  }

  const fallback = process.cwd();
  cached = fallback;
  return fallback;
}

export function setCwd(path: string): void {
  if (!existsSync(path)) {
    throw new Error("Path does not exist");
  }
  if (!statSync(path).isDirectory()) {
    throw new Error("Path is not a directory");
  }

  db.insert(authConfig)
    .values({ key: KEY, value: path })
    .onConflictDoUpdate({ target: authConfig.key, set: { value: path } })
    .run();

  cached = path;
}
