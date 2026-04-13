import { db } from "@/lib/db";
import { executions } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type { Execution, ExecutionKind } from "@/types";

export const EXECUTION_LIMIT = 500;

export interface RecordExecutionInput {
  kind: ExecutionKind;
  summary: string;
  sourceId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  firedAt?: Date;
}

function toApiExecution(row: typeof executions.$inferSelect): Execution {
  return {
    id: row.id,
    kind: row.kind,
    sourceId: row.sourceId,
    summary: row.summary,
    conversationId: row.conversationId,
    messageId: row.messageId,
    firedAt: row.firedAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

export function recordExecution(input: RecordExecutionInput): string {
  const id = crypto.randomUUID();
  db.insert(executions)
    .values({
      id,
      kind: input.kind,
      sourceId: input.sourceId ?? null,
      summary: input.summary,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      firedAt: input.firedAt ?? new Date(),
      readAt: null,
    })
    .run();
  trimExecutions();
  return id;
}

// Single DELETE keeps only the most recent EXECUTION_LIMIT rows.
// When there are fewer rows, the subquery returns no OFFSET row, the WHERE
// compares against NULL, and no rows are deleted.
export function trimExecutions(): void {
  db.run(
    sql`DELETE FROM executions WHERE fired_at < (SELECT fired_at FROM executions ORDER BY fired_at DESC LIMIT 1 OFFSET ${EXECUTION_LIMIT - 1})`,
  );
}

export function listExecutions(limit = 50): Execution[] {
  return db
    .select()
    .from(executions)
    .orderBy(desc(executions.firedAt))
    .limit(limit)
    .all()
    .map(toApiExecution);
}

export function countUnread(): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(executions)
    .where(sql`${executions.readAt} IS NULL`)
    .get();
  return Number(row?.count ?? 0);
}

export function markRead(id: string): boolean {
  const { changes } = db
    .update(executions)
    .set({ readAt: new Date() })
    .where(eq(executions.id, id))
    .run();
  return changes > 0;
}
