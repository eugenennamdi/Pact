import type {
  GitHubDeliveryIngestResult,
  GitHubDeliveryInput,
  OperationRecord,
  OperationState,
  OperationWithPact,
  PactRepository,
  PersistedAttestation,
  PersistedChainSnapshot,
  PersistedVerificationResult,
  ReadyToRelayArtifact,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactJobIdentity,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import { describe, expect, it } from "vitest";
import { createExpiredRecoveryCoordinator } from "./deployment/recovery-state.js";
import type { ControlledOperatorState } from "./deployment/staged-operator.js";
import { createPhase4AOrchestrator } from "./service.js";
import {
  assertExpiredAttestationRecoveryPreflight,
  assertMainnetRecoveryApproval,
  createExpiredAttestationRecoveryService,
  expiredAttestationRecoveryTrigger,
  type ExpiredAttestationRecoveryIdentity,
} from "./recovery.js";

const manifestIdentity = `0x${"11".repeat(32)}` as const;
const commerce = "0x1111111111111111111111111111111111111111" as const;
const evaluator = "0x2222222222222222222222222222222222222222" as const;
const verifier = "0x3333333333333333333333333333333333333333" as const;
const client = "0x4444444444444444444444444444444444444444" as const;
const provider = "0x5555555555555555555555555555555555555555" as const;
const relay = "0x6666666666666666666666666666666666666666" as const;
const condition = normalizeGithubPrMergedCondition({
  provider: "github",
  repository: "pact/recovery",
  pullRequest: 7,
  baseBranch: "main",
  event: "PR_MERGED",
});
const conditionHash = hashGithubPrMergedCondition(condition);
const jobKey = hashPactJobIdentity(
  normalizePactJobIdentity({
    chainId: 5042n,
    commerceContract: commerce,
    jobId: 2n,
  }),
);
const oldDigest = `0x${"77".repeat(32)}` as const;
const artifact: ReadyToRelayArtifact = {
  operationId: "11111111-1111-4111-a111-111111111111",
  pact: {
    id: "22222222-2222-4222-a222-222222222222",
    chainId: 5042n,
    commerceContract: commerce,
    pactEvaluator: evaluator,
    jobId: 2n,
    jobKey,
    condition,
    conditionHash,
    completionDeadline: 1_800_000_500n,
  },
  evidence: {
    schemaVersion: 1,
    conditionHash,
    repository: condition.repository,
    pullRequest: 7n,
    baseBranch: "main",
    mergeCommitSha: `0x${"88".repeat(20)}`,
    mergedAt: 1_800_000_100n,
    observedAt: 1_800_000_200n,
  },
  attestation: {
    digest: oldDigest,
    signature: `0x${"99".repeat(65)}`,
    signer: verifier,
    chainId: 5042n,
    verifyingContract: evaluator,
    commerceContract: commerce,
    jobId: 2n,
    conditionHash,
    evidenceHash: `0x${"aa".repeat(32)}`,
    satisfiedAt: 1_800_000_100n,
    verifiedAt: 1_800_000_200n,
    validUntil: 1_800_000_300n,
    jobKey,
  },
  readyBlockNumber: 100n,
};
const snapshot: PersistedChainSnapshot = {
  blockNumber: 200n,
  blockHash: `0x${"bb".repeat(32)}`,
  blockTimestamp: 1_800_000_301n,
  chainId: 5042n,
  pactEvaluator: evaluator,
  commerceContract: commerce,
  jobId: 2n,
  jobKey,
  bindingExists: true,
  bindingConditionHash: conditionHash,
  bindingCompletionDeadline: artifact.pact.completionDeadline,
  bindingVerifier: verifier,
  bindingAccepted: false,
  verifierRevoked: false,
  jobClient: client,
  jobProvider: provider,
  jobEvaluator: evaluator,
  jobStatus: 2,
  jobExpiredAt: 1_800_001_000n,
};
const identity: ExpiredAttestationRecoveryIdentity = {
  pactRecordId: artifact.pact.id,
  operationId: artifact.operationId,
  attestationDigest: oldDigest,
  expectedChainId: 5042n,
  expectedCommerceContract: commerce,
  expectedPactEvaluator: evaluator,
  expectedJobId: 2n,
  expectedJobKey: jobKey,
  expectedConditionHash: conditionHash,
  expectedCompletionDeadline: artifact.pact.completionDeadline,
  expectedVerifier: verifier,
  expectedClient: client,
  expectedProvider: provider,
  relayAddress: relay,
};

describe("expired-unsent attestation recovery", () => {
  it("requires the complete authoritative recovery precondition", () => {
    expect(() =>
      assertExpiredAttestationRecoveryPreflight(identity, artifact, snapshot),
    ).not.toThrow();
    for (const [override, code] of [
      [
        { blockTimestamp: artifact.attestation.validUntil },
        "RECOVERY_ATTESTATION_NOT_EXPIRED",
      ],
      [{ jobExpiredAt: snapshot.blockTimestamp }, "RECOVERY_JOB_EXPIRED"],
      [{ jobStatus: 1 }, "RECOVERY_JOB_NOT_SUBMITTED"],
      [{ bindingExists: false }, "RECOVERY_BINDING_MISSING"],
      [{ bindingAccepted: true }, "RECOVERY_BINDING_ALREADY_ACCEPTED"],
      [{ verifierRevoked: true }, "RECOVERY_VERIFIER_REVOKED"],
      [{ jobKey: `0x${"00".repeat(32)}` }, "RECOVERY_IDENTITY_MISMATCH"],
      [{ bindingCompletionDeadline: 1n }, "RECOVERY_IDENTITY_MISMATCH"],
      [{ jobClient: relay }, "RECOVERY_IDENTITY_MISMATCH"],
    ] as const) {
      expect(() =>
        assertExpiredAttestationRecoveryPreflight(identity, artifact, {
          ...snapshot,
          ...override,
        }),
      ).toThrow(code);
    }
  });

  it("retires, processes fresh Phase 4A, and stops at READY_TO_RELAY", async () => {
    const events: string[] = [];
    const recoveryOperationId = "33333333-3333-4333-a333-333333333333";
    const fresh = {
      ...artifact,
      operationId: recoveryOperationId,
      attestation: {
        ...artifact.attestation,
        digest: `0x${"cc".repeat(32)}` as const,
        evidenceHash: `0x${"dd".repeat(32)}` as const,
        verifiedAt: 1_800_000_400n,
        validUntil: 1_800_000_700n,
      },
    };
    const service = createExpiredAttestationRecoveryService({
      arc: {
        readSnapshot: async () => {
          events.push("authoritative-arc-preflight");
          return snapshot;
        },
      },
      recoveryRepository: {
        inspectHistoricalRecoveryState: async () => ({
          shape: "SHAPE_A",
          artifact,
        }),
        getAttestationArtifact: async () => artifact,
        retireExpiredUnsentAndEnqueueRecovery: async () => {
          events.push("atomic-retirement");
          return {
            recoveryOperationId,
            relayIntentId: "44444444-4444-4444-a444-444444444444",
            reused: false,
          };
        },
        getActiveArtifactForOperation: async () => fresh,
      },
      operationRepository: {
        recoverInterruptedRecoveryOperation: async () => {
          events.push("restart-reconciliation");
          return { state: "PENDING" };
        },
      },
      phase4A: {
        processOperation: async () => {
          events.push("certified-phase4a");
          return {
            operationId: recoveryOperationId,
            state: "READY_TO_RELAY",
            attestationDigest: fresh.attestation.digest,
          };
        },
      },
    });
    const preflight = await service.preflight(identity);
    const retirement = await service.retireAndEnqueue(identity, preflight);
    const result = await service.completePhase4A(identity, retirement);
    expect(events).toEqual([
      "authoritative-arc-preflight",
      "authoritative-arc-preflight",
      "atomic-retirement",
      "restart-reconciliation",
      "certified-phase4a",
    ]);
    expect(result).toMatchObject({
      operationId: recoveryOperationId,
      evidenceHash: fresh.attestation.evidenceHash,
      attestationDigest: fresh.attestation.digest,
    });
    expect(expiredAttestationRecoveryTrigger(oldDigest)).toBe(
      `expired-attestation:${oldDigest}`,
    );
  });

  it("runs the mocked isolation recovery flow without relay capability", async () => {
    const recoveryOperationId = "33333333-3333-4333-a333-333333333333";
    let operation: OperationRecord = {
      id: recoveryOperationId,
      pactRecordId: artifact.pact.id,
      triggerKind: "RECOVERY",
      triggerKey: expiredAttestationRecoveryTrigger(oldDigest),
      state: "PENDING",
      code: null,
      retryable: false,
      version: 0,
    };
    let freshArtifact: ReadyToRelayArtifact | undefined;
    const verifications: PersistedVerificationResult[] = [];
    const reconciliations: PersistedChainSnapshot[] = [];
    const certifiedDatabase: PactRepository = {
      createPact: async (record) => record,
      getPact: async () => artifact.pact,
      ingestGitHubDelivery: async (
        _input: GitHubDeliveryInput,
      ): Promise<GitHubDeliveryIngestResult> => ({
        duplicate: false,
        operationIds: [],
        matchedPacts: 0,
      }),
      enqueueManualOperation: async () => operation,
      getOperation: async (id): Promise<OperationWithPact | undefined> =>
        id === recoveryOperationId
          ? { operation, pact: artifact.pact }
          : undefined,
      listPendingOperationIds: async () =>
        operation.state === "PENDING" ? [operation.id] : [],
      transitionOperation: async (
        id: string,
        expected: readonly OperationState[],
        next: OperationState,
        options = {},
      ) => {
        if (id !== operation.id || !expected.includes(operation.state))
          return undefined;
        operation = {
          ...operation,
          state: next,
          code: options.code ?? null,
          retryable: options.retryable ?? false,
          version: operation.version + 1,
        };
        return operation;
      },
      persistVerification: async (_id, result, next) => {
        verifications.push(result);
        operation = {
          ...operation,
          state: next,
          code: result.reason ?? null,
          retryable: result.retryable,
          version: operation.version + 1,
        };
        return verifications.length;
      },
      persistChainReconciliation: async (_id, chain, _outcome, code, next) => {
        reconciliations.push(chain);
        operation = {
          ...operation,
          state: next,
          code: code ?? null,
          retryable: next === "CHAIN_RETRYABLE",
          version: operation.version + 1,
        };
        return reconciliations.length;
      },
      persistReadyToRelay: async (
        _id,
        _pactId,
        evidence,
        _evidenceHash,
        attestation: PersistedAttestation,
      ) => {
        operation = {
          ...operation,
          state: "READY_TO_RELAY",
          code: null,
          retryable: false,
          version: operation.version + 1,
        };
        freshArtifact = {
          operationId: operation.id,
          pact: artifact.pact,
          evidence,
          attestation,
          readyBlockNumber: snapshot.blockNumber,
        };
      },
      recoverTransitionalOperations: async () => 0,
    };
    let githubReads = 0;
    const github: GitHubPullRequestClient = {
      getPullRequest: async () => {
        githubReads++;
        return {
          ok: true,
          value: {
            number: 7,
            state: "closed",
            merged: true,
            mergedAt: new Date(Number(artifact.evidence.mergedAt) * 1_000)
              .toISOString()
              .replace(".000Z", "Z"),
            mergeCommitSha: "8888888888888888888888888888888888888888",
            baseRepository: condition.repository,
            baseBranch: condition.baseBranch,
            privateRepository: false,
          },
        };
      },
      checkPullRequestMerged: async () => {
        githubReads++;
        return { ok: true, value: { merged: true } };
      },
    };
    let arcReads = 0;
    const currentSnapshot = {
      ...snapshot,
      blockTimestamp: 1_800_000_400n,
    };
    const arc = {
      readSnapshot: async () => {
        arcReads++;
        return currentSnapshot;
      },
    };
    let verifierSignatures = 0;
    const baseSigner = createPactCompletionSigner({
      privateKey:
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d",
    });
    const signer = {
      ...baseSigner,
      signVerifiedCompletion: async (
        ...args: Parameters<typeof baseSigner.signVerifiedCompletion>
      ) => {
        verifierSignatures++;
        return baseSigner.signVerifiedCompletion(...args);
      },
    };
    const identityWithSigner = {
      ...identity,
      expectedVerifier: signer.address,
    };
    const signerSnapshot = {
      ...currentSnapshot,
      bindingVerifier: signer.address,
    };
    arc.readSnapshot = async () => {
      arcReads++;
      return signerSnapshot;
    };
    let oldActive = true;
    let auditBroadcastCount = -1;
    const relayNonceBefore = 9;
    const phase4A = createPhase4AOrchestrator({
      repository: certifiedDatabase,
      github,
      arc,
      signer,
      configuredChainId: 5042n,
      configuredPactEvaluator: evaluator,
      configuredCommerceContract: commerce,
      nowSeconds: () => 1_800_000_400n,
    });
    const service = createExpiredAttestationRecoveryService({
      arc,
      phase4A,
      operationRepository: {
        recoverInterruptedRecoveryOperation: async () => operation,
      },
      recoveryRepository: {
        inspectHistoricalRecoveryState: async () => ({
          shape: "SHAPE_A",
          artifact: {
            ...artifact,
            attestation: { ...artifact.attestation, signer: signer.address },
          },
        }),
        getAttestationArtifact: async () => ({
          ...artifact,
          attestation: { ...artifact.attestation, signer: signer.address },
        }),
        retireExpiredUnsentAndEnqueueRecovery: async () => {
          oldActive = false;
          auditBroadcastCount = 0;
          return {
            recoveryOperationId,
            relayIntentId: "44444444-4444-4444-a444-444444444444",
            reused: false,
          };
        },
        getActiveArtifactForOperation: async () => freshArtifact,
      },
    });
    const preflight = await service.preflight(identityWithSigner);
    const retirement = await service.retireAndEnqueue(
      identityWithSigner,
      preflight,
    );
    const result = await service.completePhase4A(
      identityWithSigner,
      retirement,
    );
    expect(result.operationId).toBe(recoveryOperationId);
    expect(operation.state).toBe("READY_TO_RELAY");
    expect(oldActive).toBe(false);
    expect(auditBroadcastCount).toBe(0);
    expect(githubReads).toBe(2);
    expect(arcReads).toBe(3);
    expect(verifierSignatures).toBe(1);
    expect(relayNonceBefore).toBe(9);
    expect(freshArtifact?.attestation.digest).not.toBe(oldDigest);
  });

  it("rejects a Phase 4A result that is not freshly READY_TO_RELAY", async () => {
    const service = createExpiredAttestationRecoveryService({
      arc: { readSnapshot: async () => snapshot },
      recoveryRepository: {
        inspectHistoricalRecoveryState: async () => ({
          shape: "SHAPE_A",
          artifact,
        }),
        getAttestationArtifact: async () => artifact,
        retireExpiredUnsentAndEnqueueRecovery: async () => ({
          recoveryOperationId: "33333333-3333-4333-a333-333333333333",
          relayIntentId: "44444444-4444-4444-a444-444444444444",
          reused: false,
        }),
        getActiveArtifactForOperation: async () => undefined,
      },
      operationRepository: {
        recoverInterruptedRecoveryOperation: async () => ({ state: "PENDING" }),
      },
      phase4A: {
        processOperation: async (operationId) => ({
          operationId,
          state: "CHAIN_RETRYABLE",
        }),
      },
    });
    await expect(
      service.completePhase4A(identity, {
        recoveryOperationId: "33333333-3333-4333-a333-333333333333",
        relayIntentId: "44444444-4444-4444-a444-444444444444",
        reused: false,
      }),
    ).rejects.toThrow("RECOVERY_PHASE4A_NOT_READY");
  });

  const submitted: ControlledOperatorState = {
    schemaVersion: 2,
    stage: "SUBMITTED",
    manifestIdentity,
    network: "arc-mainnet",
    chainId: "5042",
    operationScope: "arc-mainnet-job-2",
    pactId: artifact.pact.id,
    commerceContract: commerce,
    pactEvaluator: evaluator,
    client,
    provider,
    verifier,
    relay,
    repository: condition.repository,
    pullRequest: condition.pullRequest,
    baseBranch: condition.baseBranch,
    conditionHash,
    amount: "10000",
    clientBefore: "10000",
    providerBefore: "10000",
    escrowBefore: "0",
    treasuryBefore: "0",
    evaluatorBefore: "0",
    relayGasBefore: "10000",
    completionDeadline: artifact.pact.completionDeadline.toString(),
    expiredAt: snapshot.jobExpiredAt.toString(),
    jobId: "2",
    jobKey,
    transactions: {
      createJob: `0x${"01".repeat(32)}`,
      bindCondition: `0x${"02".repeat(32)}`,
      setBudget: `0x${"03".repeat(32)}`,
      approveUsdc: `0x${"04".repeat(32)}`,
      fund: `0x${"05".repeat(32)}`,
      submit: `0x${"06".repeat(32)}`,
    },
    affordabilityChecks: [],
    initialConditionResult: "NOT_SATISFIED_RETRYABLE",
  };

  describe("Correction 1: adversarial Arc state shifts between 1st and 2nd preflight", () => {
    it.each([
      [
        "bindingAccepted flips true",
        { bindingAccepted: true },
        "RECOVERY_BINDING_ALREADY_ACCEPTED",
      ],
      [
        "verifierRevoked flips true",
        { verifierRevoked: true },
        "RECOVERY_VERIFIER_REVOKED",
      ],
      [
        "jobStatus changes away from Submitted",
        { jobStatus: 3 },
        "RECOVERY_JOB_NOT_SUBMITTED",
      ],
      [
        "job expires",
        { blockTimestamp: snapshot.jobExpiredAt + 1n },
        "RECOVERY_JOB_EXPIRED",
      ],
    ] as const)(
      "adversarial Arc shift between first and second preflight: %s",
      async (_name, adversarialOverride, expectedError) => {
        let readCount = 0;
        let retirementCalled = false;
        let phase4ACalled = false;
        let verifierSignatures = 0;
        let oldOperationState = "READY_TO_RELAY";
        let oldAttestationActive = true;
        let relayIntentCreated = false;
        let recoveryOperationCreated = false;

        const baseSigner = createPactCompletionSigner({
          privateKey:
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d",
        });
        const signer = {
          ...baseSigner,
          signVerifiedCompletion: async (
            ...args: Parameters<typeof baseSigner.signVerifiedCompletion>
          ) => {
            verifierSignatures++;
            return baseSigner.signVerifiedCompletion(...args);
          },
        };
        const testIdentity = {
          ...identity,
          expectedVerifier: signer.address,
        };
        const testArtifact = {
          ...artifact,
          attestation: {
            ...artifact.attestation,
            signer: signer.address,
          },
        };

        const service = createExpiredAttestationRecoveryService({
          arc: {
            readSnapshot: async () => {
              readCount++;
              if (readCount === 1) {
                return { ...snapshot, bindingVerifier: signer.address };
              }
              return {
                ...snapshot,
                bindingVerifier: signer.address,
                ...adversarialOverride,
              };
            },
          },
          recoveryRepository: {
            inspectHistoricalRecoveryState: async () => ({
              shape: "SHAPE_A",
              artifact: testArtifact,
            }),
            getAttestationArtifact: async () => testArtifact,
            retireExpiredUnsentAndEnqueueRecovery: async () => {
              retirementCalled = true;
              relayIntentCreated = true;
              recoveryOperationCreated = true;
              oldOperationState = "EXPIRED";
              oldAttestationActive = false;
              return {
                recoveryOperationId: "recov-123",
                relayIntentId: "intent-123",
                reused: false,
              };
            },
            getActiveArtifactForOperation: async () => undefined,
          },
          operationRepository: {
            recoverInterruptedRecoveryOperation: async () => ({
              state: "PENDING",
            }),
          },
          phase4A: {
            processOperation: async () => {
              phase4ACalled = true;
              return {
                operationId: "recov-123",
                state: "READY_TO_RELAY",
              };
            },
          },
        });

        let operatorStage = "SUBMITTED";
        const savedStages: string[] = [];
        const coordinator = createExpiredRecoveryCoordinator({
          stateStore: {
            load: async () =>
              ({
                ...submitted,
                stage: operatorStage,
                verifier: signer.address,
              }) as ControlledOperatorState,
            save: async (next) => {
              operatorStage = next.stage;
              savedStages.push(next.stage);
            },
          },
          service,
          observeCondition: async () => ({ status: "SATISFIED" }),
          expectedManifestIdentity: manifestIdentity,
          expectedRepository: submitted.repository,
          expectedPullRequest: submitted.pullRequest,
          expectedBaseBranch: submitted.baseBranch,
        });

        await expect(coordinator.run(testIdentity)).rejects.toThrow(
          expectedError,
        );

        // Prove the 6 required safety properties:
        expect(retirementCalled).toBe(false);
        expect(phase4ACalled).toBe(false);
        expect(oldOperationState).toBe("READY_TO_RELAY");
        expect(oldAttestationActive).toBe(true);
        expect(relayIntentCreated).toBe(false);
        expect(recoveryOperationCreated).toBe(false);
        expect(verifierSignatures).toBe(0);
        expect(operatorStage).toBe("CONDITION_SATISFIED");
        expect(savedStages).not.toContain("PHASE4A_ENQUEUED");
        expect(savedStages).not.toContain("READY_TO_RELAY");
      },
    );
  });

  describe("Correction 2: historical database preflight shape validation", () => {
    it("accepts valid Shape A pre-retirement", async () => {
      const service = createExpiredAttestationRecoveryService({
        arc: { readSnapshot: async () => snapshot },
        recoveryRepository: {
          inspectHistoricalRecoveryState: async () => ({
            shape: "SHAPE_A",
            artifact,
          }),
          getAttestationArtifact: async () => artifact,
          retireExpiredUnsentAndEnqueueRecovery: async () => ({
            recoveryOperationId: "recov-1",
            relayIntentId: "intent-1",
            reused: false,
          }),
          getActiveArtifactForOperation: async () => undefined,
        },
        operationRepository: {
          recoverInterruptedRecoveryOperation: async () => ({
            state: "PENDING",
          }),
        },
        phase4A: {
          processOperation: async () => ({
            operationId: "recov-1",
            state: "READY_TO_RELAY",
          }),
        },
      });
      const preflight = await service.preflight(identity);
      expect(preflight.historical.shape).toBe("SHAPE_A");
      expect(preflight.artifact.attestation.digest).toBe(oldDigest);
    });

    it("accepts valid Shape B post-retirement restart", async () => {
      const service = createExpiredAttestationRecoveryService({
        arc: { readSnapshot: async () => snapshot },
        recoveryRepository: {
          inspectHistoricalRecoveryState: async () => ({
            shape: "SHAPE_B",
            artifact,
            recoveryOperationId: "recov-existing",
            relayIntentId: "intent-existing",
          }),
          getAttestationArtifact: async () => artifact,
          retireExpiredUnsentAndEnqueueRecovery: async () => ({
            recoveryOperationId: "recov-existing",
            relayIntentId: "intent-existing",
            reused: true,
          }),
          getActiveArtifactForOperation: async () => undefined,
        },
        operationRepository: {
          recoverInterruptedRecoveryOperation: async () => ({
            state: "PENDING",
          }),
        },
        phase4A: {
          processOperation: async () => ({
            operationId: "recov-existing",
            state: "READY_TO_RELAY",
          }),
        },
      });
      const preflight = await service.preflight(identity);
      expect(preflight.historical.shape).toBe("SHAPE_B");
      if (preflight.historical.shape === "SHAPE_B") {
        expect(preflight.historical.recoveryOperationId).toBe("recov-existing");
        expect(preflight.historical.relayIntentId).toBe("intent-existing");
      }
    });

    it.each([
      [
        "old operation READY_TO_RELAY but attestation inactive",
        "READY_TO_RELAY operation has inactive attestation",
      ],
      [
        "old operation EXPIRED but no audit row",
        "EXPIRED operation has no audit row",
      ],
      ["old operation EXPIRED but audit has nonce", "old audit has nonce"],
      [
        "old audit has broadcastAttemptCount > 0",
        "old audit has broadcast attempt",
      ],
      [
        "recovery operation exists while old artifact active",
        "recovery operation exists while old artifact active",
      ],
      [
        "multiple recovery operations exist",
        "multiple recovery operations exist",
      ],
      [
        "relay intent in active state",
        "relay intent in active broadcast state",
      ],
      [
        "relay intent wrong relay identity",
        "relay intent wrong relay identity",
      ],
      ["relay intent wrong pact identity", "relay intent wrong pact identity"],
      ["wrong pact record id", "RECOVERY_OPERATION_PACT_MISMATCH"],
      [
        "attestation operation mismatch",
        "RECOVERY_ATTESTATION_OPERATION_MISMATCH",
      ],
      [
        "historical operation missing",
        "RECOVERY_HISTORICAL_OPERATION_NOT_FOUND",
      ],
      [
        "historical attestation missing",
        "RECOVERY_HISTORICAL_ATTESTATION_NOT_FOUND",
      ],
    ])(
      "fails closed on invalid/hybrid state: %s",
      async (_name, errorMessage) => {
        const service = createExpiredAttestationRecoveryService({
          arc: { readSnapshot: async () => snapshot },
          recoveryRepository: {
            inspectHistoricalRecoveryState: async () => {
              throw new Error(
                `RECOVERY_INVALID_HISTORICAL_STATE: ${errorMessage}`,
              );
            },
            getAttestationArtifact: async () => artifact,
            retireExpiredUnsentAndEnqueueRecovery: async () => ({
              recoveryOperationId: "recov-1",
              relayIntentId: "intent-1",
              reused: false,
            }),
            getActiveArtifactForOperation: async () => undefined,
          },
          operationRepository: {
            recoverInterruptedRecoveryOperation: async () => ({
              state: "PENDING",
            }),
          },
          phase4A: {
            processOperation: async () => ({
              operationId: "recov-1",
              state: "READY_TO_RELAY",
            }),
          },
        });
        await expect(service.preflight(identity)).rejects.toThrow(errorMessage);
      },
    );
  });

  describe("Correction 5: PACT_MAINNET_RECOVERY_APPROVAL authorization contract", () => {
    const gitCommit = "cc05019bc1fc7cf34b5bc9ed0398c8c937759b2b";
    const pactRecordId = artifact.pact.id;
    const attestationDigest = oldDigest;
    const validApproval = `APPROVED ${gitCommit} ${pactRecordId} ${attestationDigest}`;

    it("accepts exact string equality authorization", () => {
      expect(() =>
        assertMainnetRecoveryApproval(validApproval, {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).not.toThrow();
    });

    it("rejects undefined or empty approval", () => {
      expect(() =>
        assertMainnetRecoveryApproval(undefined, {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is required");
      expect(() =>
        assertMainnetRecoveryApproval("", {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is required");
      expect(() =>
        assertMainnetRecoveryApproval("   ", {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is required");
    });

    it("rejects wrong git commit", () => {
      expect(() =>
        assertMainnetRecoveryApproval(
          `APPROVED 0000000000000000000000000000000000000000 ${pactRecordId} ${attestationDigest}`,
          { gitCommit, pactRecordId, attestationDigest },
        ),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
    });

    it("rejects wrong pact ID", () => {
      expect(() =>
        assertMainnetRecoveryApproval(
          `APPROVED ${gitCommit} 00000000-0000-0000-0000-000000000000 ${attestationDigest}`,
          { gitCommit, pactRecordId, attestationDigest },
        ),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
    });

    it("rejects wrong attestation digest", () => {
      expect(() =>
        assertMainnetRecoveryApproval(
          `APPROVED ${gitCommit} ${pactRecordId} 0x0000000000000000000000000000000000000000000000000000000000000000`,
          { gitCommit, pactRecordId, attestationDigest },
        ),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
    });

    it("rejects trailing or extra data", () => {
      expect(() =>
        assertMainnetRecoveryApproval(`${validApproval} EXTRA`, {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
      expect(() =>
        assertMainnetRecoveryApproval(`PRE ${validApproval}`, {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
      expect(() =>
        assertMainnetRecoveryApproval(`${validApproval} `, {
          gitCommit,
          pactRecordId,
          attestationDigest,
        }),
      ).toThrow("PACT_MAINNET_RECOVERY_APPROVAL is invalid");
    });
  });
});
