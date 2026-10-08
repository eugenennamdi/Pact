import { randomBytes } from "node:crypto";
import {
  getAddress,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { AUTH_NONCE_TTL_SECONDS } from "./constants";
import type { ProductNetworkConfig } from "./network";
import type { AuthNonce, ProductRepository } from "./types";

const STATEMENT = "Sign in to Pact with your wallet.";
const NONCE_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export interface Challenge {
  readonly message: string;
  readonly walletAddress: Address;
  readonly domain: string;
  readonly uri: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
}

export type ParsedChallenge = Challenge;

export type RecoverMessageAddress = (input: {
  readonly message: string;
  readonly signature: Hex;
}) => Promise<Address>;

function canonicalIso(value: Date): string {
  if (!Number.isFinite(value.getTime()))
    throw new Error("INVALID_CHALLENGE_TIME");
  return value.toISOString();
}

export function buildChallengeMessage(
  challenge: Omit<Challenge, "message">,
): string {
  return [
    `${challenge.domain} wants you to sign in with your Ethereum account:`,
    challenge.walletAddress,
    "",
    STATEMENT,
    "",
    `URI: ${challenge.uri}`,
    "Version: 1",
    `Chain ID: ${challenge.chainId}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    `Expiration Time: ${challenge.expirationTime}`,
  ].join("\n");
}

function field(line: string | undefined, prefix: string): string {
  if (line === undefined || !line.startsWith(prefix)) {
    throw new Error("INVALID_CHALLENGE_MESSAGE");
  }
  return line.slice(prefix.length);
}

export function parseChallengeMessage(message: string): ParsedChallenge {
  if (new TextEncoder().encode(message).length > 2_048) {
    throw new Error("INVALID_CHALLENGE_MESSAGE");
  }
  const lines = message.split("\n");
  if (
    lines.length !== 11 ||
    lines[2] !== "" ||
    lines[3] !== STATEMENT ||
    lines[4] !== ""
  ) {
    throw new Error("INVALID_CHALLENGE_MESSAGE");
  }
  const suffix = " wants you to sign in with your Ethereum account:";
  const first = lines[0];
  if (first === undefined || !first.endsWith(suffix)) {
    throw new Error("INVALID_CHALLENGE_MESSAGE");
  }
  const domain = first.slice(0, -suffix.length);
  const addressLine = lines[1];
  if (addressLine === undefined) throw new Error("INVALID_CHALLENGE_MESSAGE");
  const walletAddress = getAddress(addressLine);
  const uri = field(lines[5], "URI: ");
  if (lines[6] !== "Version: 1") throw new Error("INVALID_CHALLENGE_MESSAGE");
  const chainText = field(lines[7], "Chain ID: ");
  if (!/^\d+$/.test(chainText)) throw new Error("INVALID_CHALLENGE_MESSAGE");
  const chainId = Number(chainText);
  const nonce = field(lines[8], "Nonce: ");
  if (!NONCE_PATTERN.test(nonce)) throw new Error("INVALID_CHALLENGE_MESSAGE");
  const issuedAt = field(lines[9], "Issued At: ");
  const expirationTime = field(lines[10], "Expiration Time: ");
  if (
    canonicalIso(new Date(issuedAt)) !== issuedAt ||
    canonicalIso(new Date(expirationTime)) !== expirationTime
  ) {
    throw new Error("INVALID_CHALLENGE_TIME");
  }
  const parsed: Omit<ParsedChallenge, "message"> = {
    walletAddress,
    domain,
    uri,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
  };
  if (buildChallengeMessage(parsed) !== message) {
    throw new Error("NON_CANONICAL_CHALLENGE_MESSAGE");
  }
  return Object.freeze({ ...parsed, message });
}

export async function issueChallenge(input: {
  readonly repository: ProductRepository;
  readonly walletAddress: string;
  readonly publicOrigin: URL;
  readonly network: ProductNetworkConfig;
  readonly now?: Date;
}): Promise<Challenge> {
  const walletAddress = getAddress(input.walletAddress);
  const issuedAtDate = input.now ?? new Date();
  const expiresAtDate = new Date(
    issuedAtDate.getTime() + AUTH_NONCE_TTL_SECONDS * 1_000,
  );
  const stored = await input.repository.issueNonce({
    walletAddress,
    domain: input.publicOrigin.host,
    uri: input.publicOrigin.origin,
    nonce: randomBytes(18).toString("base64url"),
    chainId: input.network.chainId,
    issuedAt: issuedAtDate,
    expiresAt: expiresAtDate,
  });
  const challenge: Omit<Challenge, "message"> = {
    walletAddress,
    domain: stored.domain,
    uri: stored.uri,
    chainId: input.network.chainIdNumber,
    nonce: stored.nonce,
    issuedAt: canonicalIso(stored.issuedAt),
    expirationTime: canonicalIso(stored.expiresAt),
  };
  return Object.freeze({
    ...challenge,
    message: buildChallengeMessage(challenge),
  });
}

function validateStoredChallenge(
  parsed: ParsedChallenge,
  stored: AuthNonce,
  publicOrigin: URL,
  network: ProductNetworkConfig,
  now: Date,
): void {
  if (
    parsed.domain !== publicOrigin.host ||
    parsed.uri !== publicOrigin.origin ||
    parsed.chainId !== network.chainIdNumber ||
    stored.domain !== parsed.domain ||
    stored.uri !== parsed.uri ||
    stored.chainId !== network.chainId ||
    stored.walletAddress !== parsed.walletAddress ||
    stored.issuedAt.toISOString() !== parsed.issuedAt ||
    stored.expiresAt.toISOString() !== parsed.expirationTime
  ) {
    throw new Error("CHALLENGE_BINDING_MISMATCH");
  }
  if (stored.consumedAt !== null) throw new Error("NONCE_ALREADY_CONSUMED");
  if (stored.expiresAt <= now) throw new Error("CHALLENGE_EXPIRED");
  if (stored.issuedAt.getTime() > now.getTime() + 30_000) {
    throw new Error("CHALLENGE_ISSUED_IN_FUTURE");
  }
}

export async function verifyChallenge(input: {
  readonly repository: ProductRepository;
  readonly publicOrigin: URL;
  readonly network: ProductNetworkConfig;
  readonly message: string;
  readonly signature: string;
  readonly now?: Date;
  readonly recoverAddress?: RecoverMessageAddress;
}): Promise<Address> {
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) {
    throw new Error("INVALID_SIGNATURE");
  }
  const now = input.now ?? new Date();
  const parsed = parseChallengeMessage(input.message);
  const stored = await input.repository.getNonce(parsed.nonce);
  if (stored === undefined) throw new Error("NONCE_NOT_FOUND");
  validateStoredChallenge(
    parsed,
    stored,
    input.publicOrigin,
    input.network,
    now,
  );
  const recover = input.recoverAddress ?? recoverMessageAddress;
  const recovered = getAddress(
    await recover({
      message: input.message,
      signature: input.signature as Hex,
    }),
  );
  if (recovered !== parsed.walletAddress) throw new Error("SIGNER_MISMATCH");
  if (!(await input.repository.consumeNonce(stored.id, now))) {
    throw new Error("NONCE_ALREADY_CONSUMED");
  }
  return recovered;
}
