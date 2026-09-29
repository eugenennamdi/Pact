import type { ReadyToRelayArtifact } from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactCompletionAttestation,
  hashPactJobIdentity,
  normalizePactJobIdentity,
} from "@pact/protocol";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pactRelayAbi } from "./abi.js";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const preparedBrand: unique symbol = Symbol("PreparedPactRelayTransaction");

export interface ExactRelayTransactionRequest {
  readonly chainId: number;
  readonly from: Address;
  readonly to: Address;
  readonly value: 0n;
  readonly data: Hex;
  readonly nonce: number;
  readonly gas: bigint;
  readonly type: "eip1559" | "legacy";
  readonly gasPrice?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
}

export interface PreparedPactRelayTransaction {
  readonly [preparedBrand]: true;
  readonly artifact: ReadyToRelayArtifact;
  readonly request: ExactRelayTransactionRequest;
}

export interface SignedPactRelayTransaction {
  readonly serializedTransaction: Hex;
  readonly expectedTxHash: `0x${string}`;
}

export interface PactRelaySigner {
  readonly address: Address;
  signPactRelayTransaction(
    prepared: PreparedPactRelayTransaction,
  ): Promise<SignedPactRelayTransaction>;
}

function privateKey(value: string): `0x${string}` {
  if (!PRIVATE_KEY_PATTERN.test(value))
    throw new Error("PACT_RELAY_PRIVATE_KEY is invalid");
  const scalar = BigInt(value);
  if (scalar === 0n || scalar >= SECP256K1_ORDER)
    throw new Error("PACT_RELAY_PRIVATE_KEY is invalid");
  return value as `0x${string}`;
}

function nonzeroAddress(label: string, value: string): Address {
  if (!isAddress(value, { strict: true }))
    throw new Error(`${label} must be a canonical address`);
  const normalized = getAddress(value);
  if (normalized.toLowerCase() === ZERO_ADDRESS)
    throw new Error(`${label} must be nonzero`);
  return normalized;
}

export function buildPactRelayCalldata(artifact: ReadyToRelayArtifact): Hex {
  const { attestation } = artifact;
  return encodeFunctionData({
    abi: pactRelayAbi,
    functionName: "completeWithAttestation",
    args: [
      {
        commerceContract: attestation.commerceContract,
        jobId: attestation.jobId,
        conditionHash: attestation.conditionHash,
        evidenceHash: attestation.evidenceHash,
        satisfiedAt: attestation.satisfiedAt,
        verifiedAt: attestation.verifiedAt,
        validUntil: attestation.validUntil,
      },
      attestation.signature,
    ],
  });
}

export function assertRelayArtifactIntegrity(
  artifact: ReadyToRelayArtifact,
): void {
  const { pact, attestation } = artifact;
  const expectedJobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: pact.chainId,
      commerceContract: pact.commerceContract,
      jobId: pact.jobId,
    }),
  );
  const expectedDigest = hashPactCompletionAttestation(
    { chainId: pact.chainId, verifyingContract: pact.pactEvaluator },
    {
      commerceContract: attestation.commerceContract,
      jobId: attestation.jobId,
      conditionHash: attestation.conditionHash,
      evidenceHash: attestation.evidenceHash,
      satisfiedAt: attestation.satisfiedAt,
      verifiedAt: attestation.verifiedAt,
      validUntil: attestation.validUntil,
    },
  );
  if (
    expectedJobKey !== pact.jobKey ||
    hashGithubPrMergedCondition(pact.condition) !== pact.conditionHash ||
    hashPactGitHubPrMergedEvidenceV1(artifact.evidence) !==
      attestation.evidenceHash ||
    artifact.evidence.conditionHash !== pact.conditionHash ||
    attestation.jobKey !== pact.jobKey ||
    attestation.chainId !== pact.chainId ||
    getAddress(attestation.verifyingContract) !==
      getAddress(pact.pactEvaluator) ||
    getAddress(attestation.commerceContract) !==
      getAddress(pact.commerceContract) ||
    attestation.jobId !== pact.jobId ||
    attestation.conditionHash !== pact.conditionHash ||
    expectedDigest !== attestation.digest
  ) {
    throw new Error("READY_TO_RELAY_INTEGRITY_MISMATCH");
  }
}

export function assertPactRelayCalldata(
  artifact: ReadyToRelayArtifact,
  calldata: Hex,
): void {
  const decoded = decodeFunctionData({ abi: pactRelayAbi, data: calldata });
  if (
    decoded.functionName !== "completeWithAttestation" ||
    decoded.args === undefined
  ) {
    throw new Error("RELAY_CALLDATA_NOT_ALLOWED");
  }
  const [attestation, signature] = decoded.args;
  const expected = artifact.attestation;
  if (
    getAddress(attestation.commerceContract) !==
      getAddress(expected.commerceContract) ||
    attestation.jobId !== expected.jobId ||
    attestation.conditionHash !== expected.conditionHash ||
    attestation.evidenceHash !== expected.evidenceHash ||
    attestation.satisfiedAt !== expected.satisfiedAt ||
    attestation.verifiedAt !== expected.verifiedAt ||
    attestation.validUntil !== expected.validUntil ||
    signature !== expected.signature
  ) {
    throw new Error("RELAY_CALLDATA_ARTIFACT_MISMATCH");
  }
}

export function preparePactRelayTransaction(input: {
  readonly artifact: ReadyToRelayArtifact;
  readonly request: ExactRelayTransactionRequest;
  readonly relayAddress: Address;
  readonly configuredChainId: bigint;
  readonly configuredPactEvaluator: Address;
  readonly reservedNonce: number;
}): PreparedPactRelayTransaction {
  assertRelayArtifactIntegrity(input.artifact);
  assertPactRelayCalldata(input.artifact, input.request.data);
  if (
    BigInt(input.request.chainId) !== input.configuredChainId ||
    input.artifact.pact.chainId !== input.configuredChainId ||
    getAddress(input.request.from) !== getAddress(input.relayAddress) ||
    getAddress(input.request.to) !==
      getAddress(input.configuredPactEvaluator) ||
    getAddress(input.request.to) !==
      getAddress(input.artifact.pact.pactEvaluator) ||
    input.request.value !== 0n ||
    input.request.nonce !== input.reservedNonce ||
    input.request.gas <= 0n
  ) {
    throw new Error("RELAY_TRANSACTION_INVARIANT_VIOLATION");
  }
  if (
    (input.request.type === "eip1559" &&
      (input.request.maxFeePerGas === undefined ||
        input.request.maxPriorityFeePerGas === undefined ||
        input.request.gasPrice !== undefined)) ||
    (input.request.type === "legacy" &&
      (input.request.gasPrice === undefined ||
        input.request.maxFeePerGas !== undefined ||
        input.request.maxPriorityFeePerGas !== undefined))
  ) {
    throw new Error("RELAY_TRANSACTION_FEE_INVARIANT_VIOLATION");
  }
  return Object.freeze({
    [preparedBrand]: true as const,
    artifact: input.artifact,
    request: Object.freeze({ ...input.request }),
  });
}

export function createPactRelaySigner(options: {
  readonly privateKey: string;
  readonly verifierAddress: Address;
}): PactRelaySigner {
  const account = privateKeyToAccount(privateKey(options.privateKey));
  if (getAddress(account.address) === getAddress(options.verifierAddress))
    throw new Error("PACT_RELAY_PRIVATE_KEY must differ from verifier key");

  return Object.freeze({
    address: account.address,
    async signPactRelayTransaction(
      prepared: PreparedPactRelayTransaction,
    ): Promise<SignedPactRelayTransaction> {
      if (prepared[preparedBrand] !== true)
        throw new Error("unvalidated Pact relay transaction");
      const request = prepared.request;
      if (getAddress(request.from) !== getAddress(account.address))
        throw new Error("relay signer address mismatch");
      const common = {
        chainId: request.chainId,
        to: request.to,
        value: request.value,
        data: request.data,
        nonce: request.nonce,
        gas: request.gas,
      } as const;
      const serializedTransaction =
        request.type === "eip1559"
          ? await account.signTransaction({
              ...common,
              type: "eip1559",
              maxFeePerGas: request.maxFeePerGas!,
              maxPriorityFeePerGas: request.maxPriorityFeePerGas!,
            })
          : await account.signTransaction({
              ...common,
              type: "legacy",
              gasPrice: request.gasPrice!,
            });
      const recovered = await recoverTransactionAddress({
        serializedTransaction: serializedTransaction as TransactionSerialized,
      });
      if (getAddress(recovered) !== getAddress(account.address))
        throw new Error("signed relay transaction sender mismatch");
      return Object.freeze({
        serializedTransaction,
        expectedTxHash: keccak256(serializedTransaction),
      });
    },
  });
}

export function createPactRelaySignerFromEnv(
  verifierAddress: Address,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PactRelaySigner {
  const value = environment.PACT_RELAY_PRIVATE_KEY;
  if (value === undefined || value.length === 0)
    throw new Error("PACT_RELAY_PRIVATE_KEY is required");
  return createPactRelaySigner({
    privateKey: value,
    verifierAddress: nonzeroAddress("verifierAddress", verifierAddress),
  });
}
