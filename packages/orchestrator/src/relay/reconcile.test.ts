import type { ReadyToRelayArtifact, RelayIntentRecord } from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactCompletionAttestation,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
} from "@pact/protocol";
import { privateKeyToAccount } from "viem/accounts";
import type { TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";
import type { RelayCompletionEvent, RelayReceiptObservation } from "./chain.js";
import {
  decideRelayPreflight,
  reconcileRelayObservation,
} from "./reconcile.js";

const verifier = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d",
).address;
const relay = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
).address;
const evaluator = "0x2222222222222222222222222222222222222222" as const;
const commerce = "0x1111111111111111111111111111111111111111" as const;
const expectedHash = `0x${"99".repeat(32)}` as const;

function fixture(): ReadyToRelayArtifact {
  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: "pact-protocol/demo",
    pullRequest: 81,
    baseBranch: "main",
    event: "PR_MERGED",
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  const evidence = normalizePactGitHubPrMergedEvidenceV1({
    conditionHash,
    repository: condition.repository,
    pullRequest: condition.pullRequest,
    baseBranch: condition.baseBranch,
    mergeCommitSha: "0x0123456789abcdef0123456789abcdef01234567",
    mergedAt: 1_800_000_000n,
    observedAt: 1_800_000_010n,
  });
  const evidenceHash = hashPactGitHubPrMergedEvidenceV1(evidence);
  const jobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: 5042n,
      commerceContract: commerce,
      jobId: 81n,
    }),
  );
  const message = {
    commerceContract: commerce,
    jobId: 81n,
    conditionHash,
    evidenceHash,
    satisfiedAt: evidence.mergedAt,
    verifiedAt: evidence.observedAt,
    validUntil: 1_800_000_300n,
  } as const;
  return {
    operationId: "123e4567-e89b-42d3-a456-426614174001",
    pact: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 5042n,
      commerceContract: commerce,
      pactEvaluator: evaluator,
      jobId: 81n,
      jobKey,
      condition,
      conditionHash,
      completionDeadline: 1_800_000_120n,
    },
    evidence,
    attestation: {
      digest: hashPactCompletionAttestation(
        { chainId: 5042n, verifyingContract: evaluator },
        message,
      ),
      signature: `0x${"11".repeat(65)}`,
      signer: verifier,
      chainId: 5042n,
      verifyingContract: evaluator,
      ...message,
      jobKey,
    },
    readyBlockNumber: 100n,
  };
}

function snapshot(artifact: ReadyToRelayArtifact, mutation = {}) {
  return {
    blockNumber: 101n,
    blockHash: `0x${"aa".repeat(32)}`,
    blockTimestamp: 1_800_000_011n,
    chainId: 5042n,
    pactEvaluator: evaluator,
    commerceContract: commerce,
    jobId: 81n,
    jobKey: artifact.pact.jobKey,
    bindingExists: true,
    bindingConditionHash: artifact.pact.conditionHash,
    bindingCompletionDeadline: artifact.pact.completionDeadline,
    bindingVerifier: verifier,
    bindingAccepted: false,
    verifierRevoked: false,
    jobClient: "0x3333333333333333333333333333333333333333",
    jobProvider: "0x4444444444444444444444444444444444444444",
    jobEvaluator: evaluator,
    jobStatus: 2,
    jobExpiredAt: 1_800_001_000n,
    ...mutation,
  } as const;
}

function event(
  artifact: ReadyToRelayArtifact,
  mutation: Partial<RelayCompletionEvent> = {},
): RelayCompletionEvent {
  return {
    transactionHash: expectedHash,
    blockNumber: 101n,
    blockHash: `0x${"aa".repeat(32)}`,
    logIndex: 2,
    jobKey: artifact.pact.jobKey,
    jobId: artifact.pact.jobId,
    evidenceHash: artifact.attestation.evidenceHash,
    conditionHash: artifact.attestation.conditionHash,
    attestationDigest: artifact.attestation.digest,
    verifier,
    relayer: relay,
    ...mutation,
  };
}

function intent(artifact: ReadyToRelayArtifact): RelayIntentRecord {
  return {
    id: "123e4567-e89b-42d3-a456-426614174002",
    pactRecordId: artifact.pact.id,
    attestationDigest: artifact.attestation.digest,
    state: "SUBMITTED",
    code: null,
    retryable: false,
    chainId: 5042n,
    relayAddress: relay,
    pactEvaluator: evaluator,
    commerceContract: commerce,
    nonce: 7,
    calldata: "0x1234",
    serializedTransaction: "0x1234",
    expectedTxHash: expectedHash,
    transactionType: "eip1559",
    gasLimit: 250_000n,
    gasPrice: null,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    preDispatchBlockNumber: 100n,
    preDispatchBlockHash: `0x${"bb".repeat(32)}`,
    broadcastAttemptCount: 1,
    returnedTxHash: expectedHash,
    receiptStatus: null,
    receiptBlockNumber: null,
    receiptBlockHash: null,
    receiptTransactionIndex: null,
    canonicalTxHash: null,
    eventBlockNumber: null,
    eventBlockHash: null,
    eventLogIndex: null,
    eventRelayer: null,
    eventVerifier: null,
    version: 3,
  };
}

function receipt(
  status: "success" | "reverted",
  transactionHash = expectedHash,
): TransactionReceipt {
  return {
    blockHash: `0x${"aa".repeat(32)}`,
    blockNumber: 101n,
    contractAddress: null,
    cumulativeGasUsed: 200_000n,
    effectiveGasPrice: 1n,
    from: relay,
    gasUsed: 200_000n,
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status,
    to: evaluator,
    transactionHash,
    transactionIndex: 0,
    type: "eip1559",
  };
}

describe("relay pre-dispatch reconciliation", () => {
  it("accepts only a coherent unaccepted Submitted job before both expiries", () => {
    const artifact = fixture();
    expect(
      decideRelayPreflight({
        artifact,
        preflight: { snapshot: snapshot(artifact), completionEvents: [] },
        configuredChainId: 5042n,
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
      }),
    ).toEqual({ kind: "READY" });
  });

  it.each([
    [{ chainId: 1n }, "PRECONDITION_FAILED"],
    [{ verifierRevoked: true }, "PRECONDITION_FAILED"],
    [{ jobStatus: 1 }, "PRECONDITION_FAILED"],
    [{ blockTimestamp: 1_800_001_000n }, "EXPIRED_UNSENT"],
    [{ blockTimestamp: 1_800_000_301n }, "EXPIRED_UNSENT"],
  ] as const)(
    "fails closed for stale/mismatched chain state",
    (mutation, state) => {
      const artifact = fixture();
      expect(
        decideRelayPreflight({
          artifact,
          preflight: {
            snapshot: snapshot(artifact, mutation),
            completionEvents: [],
          },
          configuredChainId: 5042n,
          configuredPactEvaluator: evaluator,
          configuredCommerceContract: commerce,
        }),
      ).toMatchObject({ kind: "TERMINAL", state });
    },
  );

  it("recognizes exact external completion and quarantines a different attestation", () => {
    const artifact = fixture();
    const accepted = snapshot(artifact, {
      bindingAccepted: true,
      jobStatus: 3,
    });
    expect(
      decideRelayPreflight({
        artifact,
        preflight: { snapshot: accepted, completionEvents: [event(artifact)] },
        configuredChainId: 5042n,
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
      }),
    ).toMatchObject({ state: "SETTLED_EXTERNALLY" });
    expect(
      decideRelayPreflight({
        artifact,
        preflight: {
          snapshot: accepted,
          completionEvents: [
            event(artifact, { attestationDigest: `0x${"77".repeat(32)}` }),
          ],
        },
        configuredChainId: 5042n,
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
      }),
    ).toMatchObject({ state: "COMPLETED_BY_DIFFERENT_ATTESTATION" });
  });
});

describe("canonical receipt/event/post-state reconciliation", () => {
  it("requires the expected receipt, exact event, accepted binding, and Completed job", () => {
    const artifact = fixture();
    const observation: RelayReceiptObservation = {
      transactionFound: true,
      receipt: receipt("success"),
      completionEvents: [event(artifact)],
      snapshot: snapshot(artifact, { bindingAccepted: true, jobStatus: 3 }),
      latestNonce: 8,
      pendingNonce: 8,
    };
    expect(
      reconcileRelayObservation({
        intent: intent(artifact),
        artifact,
        observation,
      }),
    ).toMatchObject({ state: "SETTLED", retryable: false });
  });

  it("records a reverted expected receipt without automatic retry", () => {
    const artifact = fixture();
    expect(
      reconcileRelayObservation({
        intent: intent(artifact),
        artifact,
        observation: {
          transactionFound: true,
          receipt: receipt("reverted"),
          completionEvents: [],
          snapshot: snapshot(artifact),
          latestNonce: 8,
          pendingNonce: 8,
        },
      }),
    ).toMatchObject({ state: "REVERTED", retryable: false });
  });

  it("lets canonical external completion override a missing or reverted local result", () => {
    const artifact = fixture();
    const externalHash = `0x${"88".repeat(32)}` as const;
    expect(
      reconcileRelayObservation({
        intent: intent(artifact),
        artifact,
        observation: {
          transactionFound: false,
          completionEvents: [
            event(artifact, {
              transactionHash: externalHash,
              relayer: verifier,
            }),
          ],
          canonicalEventReceipt: receipt("success", externalHash),
          snapshot: snapshot(artifact, { bindingAccepted: true, jobStatus: 3 }),
          latestNonce: 7,
          pendingNonce: 7,
        },
      }),
    ).toMatchObject({ state: "SETTLED_EXTERNALLY" });
  });

  it("treats success without audit event/post-state as integrity failure", () => {
    const artifact = fixture();
    expect(
      reconcileRelayObservation({
        intent: intent(artifact),
        artifact,
        observation: {
          transactionFound: true,
          receipt: receipt("success"),
          completionEvents: [],
          snapshot: snapshot(artifact),
          latestNonce: 8,
          pendingNonce: 8,
        },
      }),
    ).toMatchObject({ state: "INTEGRITY_FAILURE" });
  });

  it("keeps a success receipt ahead of the sampled snapshot retryable", () => {
    const artifact = fixture();
    expect(
      reconcileRelayObservation({
        intent: intent(artifact),
        artifact,
        observation: {
          transactionFound: true,
          receipt: { ...receipt("success"), blockNumber: 102n },
          completionEvents: [],
          snapshot: snapshot(artifact),
          latestNonce: 8,
          pendingNonce: 8,
        },
      }),
    ).toMatchObject({
      state: "BROADCAST_UNKNOWN",
      code: "RECEIPT_AHEAD_OF_SNAPSHOT",
      retryable: true,
    });
  });

  it("keeps absence ambiguous regardless of nonce diagnostics", () => {
    const artifact = fixture();
    for (const [latestNonce, pendingNonce] of [
      [7, 7],
      [7, 8],
      [8, 8],
    ] as const) {
      expect(
        reconcileRelayObservation({
          intent: intent(artifact),
          artifact,
          observation: {
            transactionFound: false,
            completionEvents: [],
            snapshot: snapshot(artifact),
            latestNonce,
            pendingNonce,
          },
        }),
      ).toMatchObject({ state: "BROADCAST_UNKNOWN", retryable: true });
    }
  });
});
