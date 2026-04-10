import type { RateLimitOptions } from "./rate-limit";

const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const RATE_LIMITS = {
  login: { key: "auth:login", limit: 10, windowMs: FIVE_MINUTES },
  setup: { key: "auth:setup", limit: 10, windowMs: FIVE_MINUTES },
  recover: { key: "auth:recover", limit: 10, windowMs: FIFTEEN_MINUTES },
  changePassword: { key: "auth:change-password", limit: 8, windowMs: FIVE_MINUTES },
  changeEmail: { key: "auth:change-email", limit: 8, windowMs: FIVE_MINUTES },
  regenerateRecovery: { key: "auth:regenerate-recovery", limit: 8, windowMs: FIVE_MINUTES },
} satisfies Record<string, RateLimitOptions>;
