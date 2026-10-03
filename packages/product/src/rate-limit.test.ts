import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./rate-limit";

describe("local rate-limit policy", () => {
  it("maintains independent endpoint scopes", () => {
    const limiter = new InMemoryRateLimiter();
    const now = new Date("2026-10-03T12:00:00.000Z");
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.consume("AUTH_CHALLENGE", "client", now).allowed).toBe(
        true,
      );
    }
    expect(limiter.consume("AUTH_CHALLENGE", "client", now).allowed).toBe(
      false,
    );
    expect(limiter.consume("PUBLIC_READ", "client", now).allowed).toBe(true);
  });

  it("resets after the fixed window", () => {
    const limiter = new InMemoryRateLimiter();
    const now = new Date("2026-10-03T12:00:00.000Z");
    for (let index = 0; index < 10; index += 1) {
      limiter.consume("DRAFT_CREATE", "wallet", now);
    }
    expect(limiter.consume("DRAFT_CREATE", "wallet", now).allowed).toBe(false);
    expect(
      limiter.consume(
        "DRAFT_CREATE",
        "wallet",
        new Date(now.getTime() + 61_000),
      ).allowed,
    ).toBe(true);
  });
});
