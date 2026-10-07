import type {
  ExpiredUnsentRecoveryResult,
  HistoricalRecoveryState,
  PersistedChainSnapshot,
  PostgresPactRepository,
  PostgresRelayRepository,
  ReadyToRelayArtifact,
} from "@pact/database";
import type { Address } from "viem";
import { getAddress } from "viem";
import type { ArcReadClient } from "./chain.js";
import type { ProcessOperationResult } from "./service.js";

export interface ExpiredAttestationRecoveryIdentity {
  readonly pactRecordId: string;
  readonly operationId: string;
  readonly attestationDigest: ReadyToRelayArtifact["attestation"]["digest"];
  readonly expectedChainId: bigint;
  readonly expectedCommerceContract: Address;
  readonly expectedPactEvaluator: Address;
  readonly expectedJobId: bigint;
  readonly expectedJobKey: ReadyToRelayArtifact["pact"]["jobKey"];
  readonly expectedConditionHash: ReadyToRelayArtifact["pact"]["conditionHash"];
  readonly expectedCompletionDeadline: bigint;
  readonly expectedVerifier: Address;
  readonly expectedClient: Address;
  readonly expectedProvider: Address;
  readonly relayAddress: Address;
}

export interface ExpiredAttestationRecoveryPreflight {
  readonly historical: HistoricalRecoveryState;
  readonly artifact: ReadyToRelayArtifact;
  readonly snapshot: PersistedChainSnapshot;
  readonly recoveryTriggerKey: string;
}

interface RecoveryRepository {
  inspectHistoricalRecoveryState(input: {
    readonly pactRecordId: string;
    readonly operationId: string;
    readonly attestationDigest: ReadyToRelayArtifact["attestation"]["digest"];
    readonly expectedChainId: bigint;
    readonly expectedCommerceContract: Address;
    readonly expectedPactEvaluator: Address;
    readonly relayAddress: Address;
  }): Promise<HistoricalRecoveryState>;
  getAttestationArtifact(
    operationId: string,
    attestationDigest: ReadyToRelayArtifact["attestation"]["digest"],
  ): Promise<ReadyToRelayArtifact | undefined>;
  getActiveArtifactForOperation(
    operationId: string,
  ): Promise<ReadyToRelayArtifact | undefined>;
  retireExpiredUnsentAndEnqueueRecovery(input: {
    readonly pactRecordId: string;
    readonly operationId: string;
    readonly attestationDigest: ReadyToRelayArtifact["attestation"]["digest"];
    readonly recoveryTriggerKey: string;
    readonly relayAddress: Address;
    readonly expectedClient: Address;
    readonly expectedProvider: Address;
    readonly snapshot: PersistedChainSnapshot;
  }): Promise<ExpiredUnsentRecoveryResult>;
}

interface RecoveryOperationRepository {
  recoverInterruptedRecoveryOperation(
    operationId: string,
    triggerKey: string,
  ): Promise<{ readonly state: string }>;
}

interface Phase4AProcessor {
  processOperation(operationId: string): Promise<ProcessOperationResult>;
}

export interface ExpiredAttestationRecoveryOptions {
  readonly recoveryRepository: RecoveryRepository;
  readonly operationRepository: RecoveryOperationRepository;
  readonly arc: ArcReadClient;
  readonly phase4A: Phase4AProcessor;
}

export interface FreshReadyToRelayResult {
  readonly operationId: string;
  readonly evidenceHash: ReadyToRelayArtifact["attestation"]["evidenceHash"];
  readonly attestationDigest: ReadyToRelayArtifact["attestation"]["digest"];
  readonly verifiedAt: bigint;
  readonly validUntil: bigint;
  readonly retirement: ExpiredUnsentRecoveryResult;
}

export function expiredAttestationRecoveryTrigger(
  digest: ReadyToRelayArtifact["attestation"]["digest"],
): string {
  return `expired-attestation:${digest}`;
}

function exactAddress(left: Address, right: Address): boolean {
  return getAddress(left) === getAddress(right);
}

export function assertMainnetRecoveryApproval(
  approval: string | undefined,
  expected: {
    readonly gitCommit: string;
    readonly pactRecordId: string;
    readonly attestationDigest: string;
  },
): void {
  if (approval === undefined || approval.trim() === "")
    throw new Error("PACT_MAINNET_RECOVERY_APPROVAL is required");
  const expectedValue = `APPROVED ${expected.gitCommit} ${expected.pactRecordId} ${expected.attestationDigest}`;
  if (approval !== expectedValue)
    throw new Error("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
}

export function assertExpiredAttestationRecoveryPreflight(
  identity: ExpiredAttestationRecoveryIdentity,
  artifact: ReadyToRelayArtifact,
  snapshot: PersistedChainSnapshot,
): void {
  const { pact, attestation } = artifact;
  if (
    pact.id !== identity.pactRecordId ||
    artifact.operationId !== identity.operationId ||
    attestation.digest !== identity.attestationDigest ||
    pact.chainId !== identity.expectedChainId ||
    snapshot.chainId !== identity.expectedChainId ||
    !exactAddress(pact.commerceContract, identity.expectedCommerceContract) ||
    !exactAddress(
      snapshot.commerceContract,
      identity.expectedCommerceContract,
    ) ||
    !exactAddress(pact.pactEvaluator, identity.expectedPactEvaluator) ||
    !exactAddress(snapshot.pactEvaluator, identity.expectedPactEvaluator) ||
    pact.jobId !== identity.expectedJobId ||
    snapshot.jobId !== identity.expectedJobId ||
    pact.jobKey !== identity.expectedJobKey ||
    snapshot.jobKey !== identity.expectedJobKey ||
    pact.conditionHash !== identity.expectedConditionHash ||
    snapshot.bindingConditionHash !== identity.expectedConditionHash ||
    pact.completionDeadline !== identity.expectedCompletionDeadline ||
    snapshot.bindingCompletionDeadline !==
      identity.expectedCompletionDeadline ||
    !exactAddress(attestation.signer, identity.expectedVerifier) ||
    !exactAddress(snapshot.bindingVerifier, identity.expectedVerifier) ||
    !exactAddress(snapshot.jobClient, identity.expectedClient) ||
    !exactAddress(snapshot.jobProvider, identity.expectedProvider) ||
    attestation.chainId !== pact.chainId ||
    !exactAddress(attestation.verifyingContract, pact.pactEvaluator) ||
    !exactAddress(attestation.commerceContract, pact.commerceContract) ||
    attestation.jobId !== pact.jobId ||
    attestation.jobKey !== pact.jobKey ||
    attestation.conditionHash !== pact.conditionHash ||
    !exactAddress(snapshot.jobEvaluator, pact.pactEvaluator)
  )
    throw new Error("RECOVERY_IDENTITY_MISMATCH");
  if (!snapshot.bindingExists) throw new Error("RECOVERY_BINDING_MISSING");
  if (snapshot.bindingAccepted)
    throw new Error("RECOVERY_BINDING_ALREADY_ACCEPTED");
  if (snapshot.verifierRevoked) throw new Error("RECOVERY_VERIFIER_REVOKED");
  if (snapshot.jobStatus !== 2) throw new Error("RECOVERY_JOB_NOT_SUBMITTED");
  if (snapshot.blockTimestamp >= snapshot.jobExpiredAt)
    throw new Error("RECOVERY_JOB_EXPIRED");
  if (attestation.validUntil >= snapshot.blockTimestamp)
    throw new Error("RECOVERY_ATTESTATION_NOT_EXPIRED");
}

export function createExpiredAttestationRecoveryService(
  options: ExpiredAttestationRecoveryOptions,
) {
  return Object.freeze({
    async preflight(
      identity: ExpiredAttestationRecoveryIdentity,
    ): Promise<ExpiredAttestationRecoveryPreflight> {
      const historical =
        await options.recoveryRepository.inspectHistoricalRecoveryState({
          pactRecordId: identity.pactRecordId,
          operationId: identity.operationId,
          attestationDigest: identity.attestationDigest,
          expectedChainId: identity.expectedChainId,
          expectedCommerceContract: identity.expectedCommerceContract,
          expectedPactEvaluator: identity.expectedPactEvaluator,
          relayAddress: identity.relayAddress,
        });
      const artifact = historical.artifact;
      const snapshot = await options.arc.readSnapshot({
        pactEvaluator: identity.expectedPactEvaluator,
        commerceContract: identity.expectedCommerceContract,
        jobId: identity.expectedJobId,
      });
      assertExpiredAttestationRecoveryPreflight(identity, artifact, snapshot);
      return {
        historical,
        artifact,
        snapshot,
        recoveryTriggerKey: expiredAttestationRecoveryTrigger(
          identity.attestationDigest,
        ),
      };
    },

    async retireAndEnqueue(
      identity: ExpiredAttestationRecoveryIdentity,
      preflight: ExpiredAttestationRecoveryPreflight,
    ): Promise<ExpiredUnsentRecoveryResult> {
      // Immediately before retirement, perform a second authoritative Arc read
      // to eliminate TOCTOU race condition.
      const freshSnapshot = await options.arc.readSnapshot({
        pactEvaluator: identity.expectedPactEvaluator,
        commerceContract: identity.expectedCommerceContract,
        jobId: identity.expectedJobId,
      });
      assertExpiredAttestationRecoveryPreflight(
        identity,
        preflight.artifact,
        freshSnapshot,
      );
      // Only the second fresh snapshot authorizes and is supplied to retirement.
      return options.recoveryRepository.retireExpiredUnsentAndEnqueueRecovery({
        pactRecordId: identity.pactRecordId,
        operationId: identity.operationId,
        attestationDigest: identity.attestationDigest,
        recoveryTriggerKey: preflight.recoveryTriggerKey,
        relayAddress: identity.relayAddress,
        expectedClient: identity.expectedClient,
        expectedProvider: identity.expectedProvider,
        snapshot: freshSnapshot,
      });
    },

    async completePhase4A(
      identity: ExpiredAttestationRecoveryIdentity,
      retirement: ExpiredUnsentRecoveryResult,
    ): Promise<FreshReadyToRelayResult> {
      const triggerKey = expiredAttestationRecoveryTrigger(
        identity.attestationDigest,
      );
      const recovered =
        await options.operationRepository.recoverInterruptedRecoveryOperation(
          retirement.recoveryOperationId,
          triggerKey,
        );
      if (recovered.state !== "READY_TO_RELAY") {
        const processed = await options.phase4A.processOperation(
          retirement.recoveryOperationId,
        );
        if (processed.state !== "READY_TO_RELAY")
          throw new Error(
            `RECOVERY_PHASE4A_NOT_READY:${processed.state}:${processed.code ?? ""}`,
          );
      }
      const fresh =
        await options.recoveryRepository.getActiveArtifactForOperation(
          retirement.recoveryOperationId,
        );
      if (fresh === undefined)
        throw new Error("RECOVERY_FRESH_ARTIFACT_MISSING");
      if (fresh.attestation.digest === identity.attestationDigest)
        throw new Error("RECOVERY_FRESH_ATTESTATION_REUSED");
      return {
        operationId: retirement.recoveryOperationId,
        evidenceHash: fresh.attestation.evidenceHash,
        attestationDigest: fresh.attestation.digest,
        verifiedAt: fresh.attestation.verifiedAt,
        validUntil: fresh.attestation.validUntil,
        retirement,
      };
    },
  });
}

// Compile-time boundary: recovery accepts the concrete repositories but never
// imports or constructs any Phase 4B relay service, signer, or transport.
export type CertifiedRecoveryRepositories = Readonly<{
  pact: PostgresPactRepository;
  relay: PostgresRelayRepository;
}>;
