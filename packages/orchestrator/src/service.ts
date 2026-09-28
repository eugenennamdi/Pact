import type {
  OperationState,
  PactRepository,
  PersistedVerificationResult,
} from "@pact/database";
import type {
  GitHubPullRequestClient,
  VerifiedGitHubCompletion,
} from "@pact/verifier/github";
import { verifyGitHubPrMerged } from "@pact/verifier/github";
import type { PactCompletionSigner } from "@pact/verifier/signer";
import type { Address } from "viem";
import { ArcReadError, type ArcReadClient } from "./chain.js";
import { reconcileForSigning } from "./reconcile.js";

export interface Phase4AOrchestratorOptions {
  readonly repository: PactRepository;
  readonly github: GitHubPullRequestClient;
  readonly arc: ArcReadClient;
  readonly signer: PactCompletionSigner;
  readonly configuredChainId: bigint;
  readonly configuredPactEvaluator: Address;
  readonly configuredCommerceContract: Address;
  readonly nowSeconds?: () => bigint;
}

export interface ProcessOperationResult {
  readonly operationId: string;
  readonly state: OperationState;
  readonly code?: string;
  readonly attestationDigest?: string;
}

function defaultNowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1_000));
}

function persistedVerification(
  result: Awaited<ReturnType<typeof verifyGitHubPrMerged>>,
): PersistedVerificationResult {
  if (result.status === "SATISFIED") {
    return {
      observedAt: result.observedAt,
      status: result.status,
      retryable: false,
      evidence: result.evidence,
      evidenceHash: result.evidenceHash,
    };
  }
  return {
    observedAt: 0n,
    status: result.status,
    reason: result.reason,
    retryable: result.retryable,
    ...(result.status === "INDETERMINATE" &&
    result.rateLimit?.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: result.rateLimit.retryAfterSeconds }
      : {}),
    ...(result.status === "INDETERMINATE" &&
    result.rateLimit?.remaining !== undefined
      ? { rateLimitRemaining: result.rateLimit.remaining }
      : {}),
    ...(result.status === "INDETERMINATE" &&
    result.rateLimit?.resetAt !== undefined
      ? { rateLimitResetAt: result.rateLimit.resetAt }
      : {}),
  };
}

export function createPhase4AOrchestrator(options: Phase4AOrchestratorOptions) {
  const nowSeconds = options.nowSeconds ?? defaultNowSeconds;

  return Object.freeze({
    async processOperation(
      operationId: string,
    ): Promise<ProcessOperationResult> {
      const loaded = await options.repository.getOperation(operationId);
      if (loaded === undefined)
        return {
          operationId,
          state: "FAILED_DEFINITE",
          code: "OPERATION_NOT_FOUND",
        };
      const claimed = await options.repository.transitionOperation(
        operationId,
        ["PENDING"],
        "VERIFYING_GITHUB",
      );
      if (claimed === undefined) {
        const current = await options.repository.getOperation(operationId);
        return {
          operationId,
          state: current?.operation.state ?? "FAILED_DEFINITE",
          code: "NOT_CLAIMED",
        };
      }

      const observedAt = nowSeconds();
      let verification: Awaited<ReturnType<typeof verifyGitHubPrMerged>>;
      try {
        verification = await verifyGitHubPrMerged({
          condition: loaded.pact.condition,
          completionDeadline: loaded.pact.completionDeadline,
          observedAt,
          client: options.github,
        });
      } catch {
        await options.repository.transitionOperation(
          operationId,
          ["VERIFYING_GITHUB"],
          "FAILED_DEFINITE",
          { code: "VERIFICATION_INTEGRITY_ERROR" },
        );
        return {
          operationId,
          state: "FAILED_DEFINITE",
          code: "VERIFICATION_INTEGRITY_ERROR",
        };
      }
      const persistent = {
        ...persistedVerification(verification),
        observedAt,
      };
      if (verification.status === "NOT_SATISFIED") {
        const state = verification.retryable
          ? "NOT_SATISFIED_RETRYABLE"
          : "NOT_SATISFIED_TERMINAL";
        await options.repository.persistVerification(
          operationId,
          persistent,
          state,
        );
        return { operationId, state, code: verification.reason };
      }
      if (verification.status === "INDETERMINATE") {
        await options.repository.persistVerification(
          operationId,
          persistent,
          "INDETERMINATE",
        );
        return {
          operationId,
          state: "INDETERMINATE",
          code: verification.reason,
        };
      }

      await options.repository.persistVerification(
        operationId,
        persistent,
        "VERIFIED",
      );
      const chainClaim = await options.repository.transitionOperation(
        operationId,
        ["VERIFIED"],
        "RECONCILING_CHAIN",
      );
      if (chainClaim === undefined)
        return { operationId, state: "VERIFIED", code: "CHAIN_CAS_LOST" };

      let snapshot;
      try {
        snapshot = await options.arc.readSnapshot({
          pactEvaluator: options.configuredPactEvaluator,
          commerceContract: options.configuredCommerceContract,
          jobId: loaded.pact.jobId,
        });
      } catch (error) {
        const code = error instanceof ArcReadError ? error.code : "RPC_FAILURE";
        await options.repository.transitionOperation(
          operationId,
          ["RECONCILING_CHAIN"],
          "CHAIN_RETRYABLE",
          { code, retryable: true },
        );
        return { operationId, state: "CHAIN_RETRYABLE", code };
      }

      const reconciliation = reconcileForSigning({
        pact: loaded.pact,
        verification,
        snapshot,
        configuredChainId: options.configuredChainId,
        configuredPactEvaluator: options.configuredPactEvaluator,
        configuredCommerceContract: options.configuredCommerceContract,
        signerAddress: options.signer.address,
        attestationTtlSeconds: options.signer.attestationTtlSeconds,
      });
      if (!reconciliation.ok) {
        await options.repository.persistChainReconciliation(
          operationId,
          snapshot,
          reconciliation.retryable ? "RETRYABLE" : "INVALID",
          reconciliation.code,
          reconciliation.state,
        );
        return {
          operationId,
          state: reconciliation.state,
          code: reconciliation.code,
        };
      }
      await options.repository.persistChainReconciliation(
        operationId,
        snapshot,
        "READY",
        undefined,
        "READY_TO_SIGN",
      );
      const signingClaim = await options.repository.transitionOperation(
        operationId,
        ["READY_TO_SIGN"],
        "SIGNING",
      );
      if (signingClaim === undefined)
        return {
          operationId,
          state: "READY_TO_SIGN",
          code: "SIGNING_CAS_LOST",
        };

      let signed;
      try {
        signed = await options.signer.signVerifiedCompletion(
          verification as VerifiedGitHubCompletion,
          reconciliation.context,
        );
      } catch {
        await options.repository.transitionOperation(
          operationId,
          ["SIGNING"],
          "FAILED_DEFINITE",
          { code: "SIGNING_FAILED" },
        );
        return {
          operationId,
          state: "FAILED_DEFINITE",
          code: "SIGNING_FAILED",
        };
      }

      await options.repository.persistReadyToRelay(
        operationId,
        loaded.pact.id,
        verification.evidence,
        verification.evidenceHash,
        {
          digest: signed.digest,
          signature: signed.signature,
          signer: signed.signer,
          chainId: signed.domain.chainId,
          verifyingContract: signed.domain.verifyingContract,
          commerceContract: signed.attestation.commerceContract,
          jobId: signed.attestation.jobId,
          conditionHash: signed.attestation.conditionHash,
          evidenceHash: signed.attestation.evidenceHash,
          satisfiedAt: signed.attestation.satisfiedAt,
          verifiedAt: signed.attestation.verifiedAt,
          validUntil: signed.attestation.validUntil,
          jobKey: loaded.pact.jobKey,
        },
      );
      return {
        operationId,
        state: "READY_TO_RELAY",
        attestationDigest: signed.digest,
      };
    },
  });
}
