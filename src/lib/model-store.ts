import { db } from "@/lib/db";
import { authConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_MODEL, isValidModel } from "@/lib/models";

export function getModel(): string {
  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, "model"))
    .get();
  const value = row?.value ?? DEFAULT_MODEL;
  return isValidModel(value) ? value : DEFAULT_MODEL;
}

export function setModel(model: string): void {
  if (!isValidModel(model)) {
    throw new Error(`Invalid model: ${model}`);
  }
  db.insert(authConfig)
    .values({ key: "model", value: model })
    .onConflictDoUpdate({ target: authConfig.key, set: { value: model } })
    .run();
}
