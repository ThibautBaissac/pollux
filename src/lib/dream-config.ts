// All tunable Dream constants in one place.

export const dream = {
  /** How often Dream runs (ms). */
  intervalMs: 10 * 60 * 1000,
  /** Delay before the first run after server start (ms). */
  startupDelayMs: 30_000,
  /** Model used for all Dream LLM calls. */
  model: "claude-sonnet-4-6",
  /** Max recent history entries injected into the system prompt. */
  recentHistoryLimit: 50,

  /** Phase 1 — Summarize recent conversations. */
  phase1: {
    maxTurns: 1,
    maxBudgetUsd: 0.2,
  },

  /** Phase 2 — Analyze + edit memory files. */
  phase2: {
    /** Min unprocessed entries before Phase 2 runs early. */
    minEntries: 2,
    /** Max time before Phase 2 runs regardless of entry count (ms). */
    maxDelayMs: 1 * 60 * 60 * 1000,
    analysisMaxTurns: 1,
    analysisMaxBudgetUsd: 0.02,
    editMaxTurns: 5,
    editMaxBudgetUsd: 0.5,
  },
};
