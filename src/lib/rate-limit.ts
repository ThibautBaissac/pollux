import { NextRequest, NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, RateLimitEntry>();

function getClientKey(_request: NextRequest): string {
  // Local-first app: ignore spoofable X-Forwarded-For / X-Real-IP headers.
  // All requests share one bucket per rate-limit key.
  return "local";
}

function pruneExpired(now: number) {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
): NextResponse | null {
  const now = Date.now();
  pruneExpired(now);

  const bucketKey = `${options.key}:${getClientKey(request)}`;
  const entry = buckets.get(bucketKey);

  if (!entry || entry.resetAt <= now) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  if (entry.count >= options.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - now) / 1000),
    );

    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }

  entry.count += 1;
  buckets.set(bucketKey, entry);
  return null;
}
