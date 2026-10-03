import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress } from "viem";
import {
  PRODUCT_CHAIN_ID_NUMBER,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SESSION_VERSION,
} from "./constants";
import { validateSessionSecret } from "./config";
import type { SessionClaims } from "./types";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createSessionToken(input: {
  readonly walletAddress: string;
  readonly secret: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}): string {
  const secret = validateSessionSecret(input.secret);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const ttl = input.ttlSeconds ?? SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 3_600) {
    throw new Error("INVALID_SESSION_TTL");
  }
  const payload: SessionClaims = {
    walletAddress: getAddress(input.walletAddress),
    chainId: PRODUCT_CHAIN_ID_NUMBER,
    issuedAt: now,
    expiresAt: now + ttl,
    version: SESSION_VERSION,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifySessionToken(input: {
  readonly token: string;
  readonly secret: string;
  readonly now?: Date;
}): SessionClaims {
  const secret = validateSessionSecret(input.secret);
  const [payloadPart, signaturePart, extra] = input.token.split(".");
  if (
    payloadPart === undefined ||
    signaturePart === undefined ||
    extra !== undefined ||
    payloadPart.length > 1_024 ||
    !/^[A-Za-z0-9_-]+$/.test(payloadPart) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signaturePart)
  ) {
    throw new Error("INVALID_SESSION");
  }
  const expected = Buffer.from(sign(payloadPart, secret));
  const received = Buffer.from(signaturePart);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error("INVALID_SESSION");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_SESSION");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("INVALID_SESSION");
  }
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !==
      "chainId,expiresAt,issuedAt,version,walletAddress" ||
    typeof value.walletAddress !== "string" ||
    value.chainId !== PRODUCT_CHAIN_ID_NUMBER ||
    typeof value.issuedAt !== "number" ||
    !Number.isSafeInteger(value.issuedAt) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.version !== SESSION_VERSION
  ) {
    throw new Error("INVALID_SESSION");
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    value.expiresAt <= now ||
    value.issuedAt > now + 30 ||
    value.expiresAt <= value.issuedAt
  ) {
    throw new Error("SESSION_EXPIRED");
  }
  return Object.freeze({
    walletAddress: getAddress(value.walletAddress),
    chainId: PRODUCT_CHAIN_ID_NUMBER,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    version: SESSION_VERSION,
  });
}

export function serializeSessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function sessionTokenFromCookie(
  header: string | null,
): string | undefined {
  if (header === null || header.length > 4_096) return undefined;
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}
