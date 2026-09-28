import {
  getPactAttestationDomain,
  hashPactCompletionAttestation,
  pactCompletionAttestationTypes,
  type PactCompletionAttestationV2,
} from "@pact/protocol";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  assertVerifiedGitHubCompletion,
  type VerifiedGitHubCompletion,
} from "../internal/verified.js";

export const DEFAULT_ATTESTATION_TTL_SECONDS = 300n;
export const MIN_ATTESTATION_TTL_SECONDS = 30n;
export const MAX_ATTESTATION_TTL_SECONDS = 900n;

const UINT48_MAX = (1n << 48n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface PactCompletionSignerOptions {
  readonly privateKey: string;
  readonly attestationTtlSeconds?: number | bigint;
}

export interface SignVerifiedCompletionContext {
  readonly chainId: number | bigint;
  readonly verifyingContract: Address;
  readonly commerceContract: Address;
  readonly jobId: number | bigint;
  readonly erc8183ExpiredAt: number | bigint;
}

export interface SignedPactCompletion {
  readonly signer: Address;
  readonly domain: ReturnType<typeof getPactAttestationDomain>;
  readonly attestation: PactCompletionAttestationV2;
  readonly digest: Hex;
  readonly signature: Hex;
}

export interface PactCompletionSigner {
  readonly address: Address;
  readonly attestationTtlSeconds: bigint;
  signVerifiedCompletion(
    completion: VerifiedGitHubCompletion,
    context: SignVerifiedCompletionContext,
  ): Promise<SignedPactCompletion>;
}

function positiveInteger(
  label: string,
  value: number | bigint,
  maximum: bigint,
): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or bigint`);
  }
  const normalized = BigInt(value);
  if (normalized <= 0n || normalized > maximum) {
    throw new Error(`${label} is outside its supported positive integer range`);
  }
  return normalized;
}

function nonzeroAddress(label: string, value: string): Address {
  if (!isAddress(value, { strict: true })) {
    throw new Error(`${label} must be a canonical 20-byte address`);
  }
  const address = getAddress(value);
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} must not be the zero address`);
  }
  return address;
}

function validatePrivateKey(value: string): `0x${string}` {
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    throw new Error("PACT_VERIFIER_PRIVATE_KEY is invalid");
  }
  const scalar = BigInt(value);
  if (scalar === 0n || scalar >= SECP256K1_ORDER) {
    throw new Error("PACT_VERIFIER_PRIVATE_KEY is invalid");
  }
  return value as `0x${string}`;
}

export function createPactCompletionSigner(
  options: PactCompletionSignerOptions,
): PactCompletionSigner {
  const account = privateKeyToAccount(validatePrivateKey(options.privateKey));
  const attestationTtlSeconds = positiveInteger(
    "attestationTtlSeconds",
    options.attestationTtlSeconds ?? DEFAULT_ATTESTATION_TTL_SECONDS,
    MAX_ATTESTATION_TTL_SECONDS,
  );
  if (attestationTtlSeconds < MIN_ATTESTATION_TTL_SECONDS) {
    throw new Error(
      `attestationTtlSeconds must be at least ${MIN_ATTESTATION_TTL_SECONDS}`,
    );
  }

  async function signVerifiedCompletion(
    completion: VerifiedGitHubCompletion,
    context: SignVerifiedCompletionContext,
  ): Promise<SignedPactCompletion> {
    assertVerifiedGitHubCompletion(completion);
    const chainId = positiveInteger("chainId", context.chainId, UINT256_MAX);
    const jobId = positiveInteger("jobId", context.jobId, UINT256_MAX);
    const expiredAt = positiveInteger(
      "erc8183ExpiredAt",
      context.erc8183ExpiredAt,
      UINT48_MAX,
    );
    const verifyingContract = nonzeroAddress(
      "verifyingContract",
      context.verifyingContract,
    );
    const commerceContract = nonzeroAddress(
      "commerceContract",
      context.commerceContract,
    );
    if (expiredAt <= completion.observedAt) {
      throw new Error("ERC-8183 expiry must be later than verification time");
    }
    const validUntil =
      completion.observedAt + attestationTtlSeconds < expiredAt
        ? completion.observedAt + attestationTtlSeconds
        : expiredAt - 1n;
    if (validUntil < completion.observedAt) {
      throw new Error("attestation validity window is empty");
    }

    const domain = getPactAttestationDomain({
      chainId,
      verifyingContract,
    });
    const attestation: PactCompletionAttestationV2 = Object.freeze({
      commerceContract,
      jobId,
      conditionHash: completion.conditionHash,
      evidenceHash: completion.evidenceHash,
      satisfiedAt: completion.satisfiedAt,
      verifiedAt: completion.observedAt,
      validUntil,
    });
    const digest = hashPactCompletionAttestation(domain, attestation);
    const signature = await account.signTypedData({
      domain,
      types: pactCompletionAttestationTypes,
      primaryType: "PactCompletionAttestation",
      message: attestation,
    });
    return Object.freeze({
      signer: account.address,
      domain,
      attestation,
      digest,
      signature,
    });
  }

  return Object.freeze({
    address: account.address,
    attestationTtlSeconds,
    signVerifiedCompletion,
  });
}

export function createPactCompletionSignerFromEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PactCompletionSigner {
  const privateKey = environment.PACT_VERIFIER_PRIVATE_KEY;
  if (privateKey === undefined) {
    throw new Error("PACT_VERIFIER_PRIVATE_KEY is required");
  }
  const ttl = environment.PACT_ATTESTATION_TTL_SECONDS;
  return createPactCompletionSigner({
    privateKey,
    ...(ttl === undefined ? {} : { attestationTtlSeconds: BigInt(ttl) }),
  });
}
