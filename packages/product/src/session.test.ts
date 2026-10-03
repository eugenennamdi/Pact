import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  clearSessionCookie,
  createSessionToken,
  serializeSessionCookie,
  sessionTokenFromCookie,
  verifySessionToken,
} from "./session";

const WALLET = getAddress("0x1111111111111111111111111111111111111111");
const TEST_KEY = "s".repeat(64);
const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("wallet sessions", () => {
  it("authenticates a signed short-lived wallet session", () => {
    const token = createSessionToken({
      walletAddress: WALLET,
      secret: TEST_KEY,
      now: NOW,
    });
    const claims = verifySessionToken({
      token,
      secret: TEST_KEY,
      now: new Date(NOW.getTime() + 1_000),
    });
    expect(claims.walletAddress).toBe(WALLET);
    expect(claims.chainId).toBe(5_042_002);
  });

  it("rejects a tampered session token", () => {
    const token = createSessionToken({
      walletAddress: WALLET,
      secret: TEST_KEY,
      now: NOW,
    });
    expect(() =>
      verifySessionToken({
        token: `${token.slice(0, -1)}x`,
        secret: TEST_KEY,
        now: NOW,
      }),
    ).toThrow("INVALID_SESSION");
  });

  it("rejects an expired session", () => {
    const token = createSessionToken({
      walletAddress: WALLET,
      secret: TEST_KEY,
      now: NOW,
      ttlSeconds: 60,
    });
    expect(() =>
      verifySessionToken({
        token,
        secret: TEST_KEY,
        now: new Date(NOW.getTime() + 60_000),
      }),
    ).toThrow("SESSION_EXPIRED");
  });

  it("sets HttpOnly, SameSite, Path, Max-Age and production Secure attributes", () => {
    const cookie = serializeSessionCookie("token", true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(sessionTokenFromCookie(`other=1; ${cookie}`)).toBe("token");
  });

  it("clears the session cookie for logout", () => {
    expect(clearSessionCookie(true)).toContain("Max-Age=0");
  });
});
