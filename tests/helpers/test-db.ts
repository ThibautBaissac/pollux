import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { join } from "path";

import * as schema from "@/lib/db/schema";

const drizzleDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const MIGRATIONS = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(drizzleDir, f), "utf-8"));

export interface TestDbContext {
  rootDir: string;
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle>;
  cleanup: () => void;
}

export function createTestDb(): TestDbContext {
  const rootDir = mkdtempSync(join(tmpdir(), "pollux-db-"));
  mkdirSync(join(rootDir, "data", "memory"), { recursive: true });

  const sqlite = new Database(join(rootDir, "data", "pollux.db"));
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(MIGRATIONS.join("\n"));

  return {
    rootDir,
    sqlite,
    db: drizzle(sqlite, { schema }),
    cleanup() {
      sqlite.close();
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
