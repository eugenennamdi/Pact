export type RateLimitScope =
  | "AUTH_CHALLENGE"
  | "AUTH_SESSION"
  | "DRAFT_CREATE"
  | "WALLET_ACTION"
  | "PUBLIC_READ";

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(scope: RateLimitScope, key: string, now?: Date): RateLimitDecision;
}

const POLICY: Readonly<
  Record<RateLimitScope, { limit: number; windowSeconds: number }>
> = {
  AUTH_CHALLENGE: { limit: 10, windowSeconds: 60 },
  AUTH_SESSION: { limit: 20, windowSeconds: 60 },
  DRAFT_CREATE: { limit: 10, windowSeconds: 60 },
  WALLET_ACTION: { limit: 30, windowSeconds: 60 },
  PUBLIC_READ: { limit: 120, windowSeconds: 60 },
};

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_LOCAL_BUCKETS = 10_000;

/**
 * Single-process development fallback. Hosting Phase 6G must replace this with
 * a deployment-grade distributed limiter and a trusted proxy/client-IP policy.
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, Bucket>();

  consume(
    scope: RateLimitScope,
    key: string,
    now = new Date(),
  ): RateLimitDecision {
    const policy = POLICY[scope];
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const bucketKey = `${scope}:${key.slice(0, 256)}`;
    const existing = this.#buckets.get(bucketKey);
    if (existing === undefined || existing.resetAt <= nowSeconds) {
      if (this.#buckets.size >= MAX_LOCAL_BUCKETS) {
        for (const [storedKey, bucket] of this.#buckets) {
          if (bucket.resetAt <= nowSeconds) this.#buckets.delete(storedKey);
        }
      }
      if (existing === undefined && this.#buckets.size >= MAX_LOCAL_BUCKETS) {
        return { allowed: false, retryAfterSeconds: 60 };
      }
      this.#buckets.set(bucketKey, {
        count: 1,
        resetAt: nowSeconds + policy.windowSeconds,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= policy.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, existing.resetAt - nowSeconds),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
