import type { ArcReadClient, ProcessOperationResult } from "@pact/orchestrator";
import type {
  OperationRecord,
  PactRecord,
  PactRepository,
  PersistedChainSnapshot,
} from "@pact/database";
import { getAddress, type Address } from "viem";
import { AUTOMATION_CHAIN_ID } from "./config.js";
import type {
  AutomationLease,
  AutomationRepository,
  WorkerLogger,
} from "./types.js";

interface Phase4AAdapter {
  processOperation(operationId: string): Promise<ProcessOperationResult>;
}

export interface VerifierSchedulerOptions {
  readonly automation: AutomationRepository;
  readonly certifiedRepository: Pick<
    PactRepository,
    "getPact" | "enqueueManualOperation"
  >;
  readonly arc: ArcReadClient;
  readonly orchestrator: Phase4AAdapter;
  readonly workerId: string;
  readonly leaseSeconds: number;
  readonly batchSize: number;
  readonly pollSeconds?: number;
  readonly maximumBackoffSeconds?: number;
  readonly configuredPactEvaluator: Address;
  readonly configuredCommerceContract: Address;
  readonly configuredVerifier: Address;
  readonly logger?: WorkerLogger;
}

export interface SchedulerOutcome {
  readonly automationId: string;
  readonly operationId?: string;
  readonly result: string;
}

function sameAddress(left: string, right: string): boolean {
  return getAddress(left) === getAddress(right);
}

function eligibility(
  pact: PactRecord,
  snapshot: PersistedChainSnapshot,
  options: Pick<
    VerifierSchedulerOptions,
    | "configuredPactEvaluator"
    | "configuredCommerceContract"
    | "configuredVerifier"
  >,
):
  | { readonly eligible: true }
  | { readonly eligible: false; readonly code: string } {
  if (
    pact.chainId !== AUTOMATION_CHAIN_ID ||
    snapshot.chainId !== AUTOMATION_CHAIN_ID ||
    !sameAddress(pact.pactEvaluator, options.configuredPactEvaluator) ||
    !sameAddress(snapshot.pactEvaluator, options.configuredPactEvaluator) ||
    !sameAddress(pact.commerceContract, options.configuredCommerceContract) ||
    !sameAddress(
      snapshot.commerceContract,
      options.configuredCommerceContract,
    ) ||
    snapshot.jobId !== pact.jobId ||
    snapshot.jobKey !== pact.jobKey ||
    !snapshot.bindingExists ||
    snapshot.bindingConditionHash !== pact.conditionHash ||
    snapshot.bindingCompletionDeadline !== pact.completionDeadline ||
    !sameAddress(snapshot.bindingVerifier, options.configuredVerifier) ||
    !sameAddress(snapshot.jobEvaluator, options.configuredPactEvaluator)
  ) {
    return { eligible: false, code: "AUTOMATION_INTEGRITY_MISMATCH" };
  }
  if (snapshot.bindingAccepted || snapshot.jobStatus === 3)
    return { eligible: false, code: "ALREADY_COMPLETED" };
  if (
    snapshot.blockTimestamp >= pact.completionDeadline ||
    snapshot.blockTimestamp >= snapshot.jobExpiredAt
  ) {
    return { eligible: false, code: "AUTOMATION_EXPIRED" };
  }
  if (snapshot.jobStatus !== 2)
    return { eligible: false, code: "JOB_NOT_SUBMITTED" };
  return { eligible: true };
}

function retryDelay(
  failures: number,
  baseSeconds: number,
  maximumSeconds: number,
): number {
  return Math.min(maximumSeconds, baseSeconds * 2 ** Math.min(failures, 5));
}

export function createVerifierScheduler(options: VerifierSchedulerOptions) {
  const pollSeconds = options.pollSeconds ?? 30;
  const maximumBackoffSeconds = options.maximumBackoffSeconds ?? 900;
  const logger = options.logger ?? (() => undefined);

  async function finish(
    lease: AutomationLease,
    input: {
      readonly result: string;
      readonly delaySeconds: number;
      readonly retryableFailure: boolean;
      readonly enabled: boolean;
      readonly operation?: OperationRecord;
    },
  ): Promise<SchedulerOutcome> {
    const completed = await options.automation.completeLease({
      id: lease.id,
      owner: options.workerId,
      token: lease.leaseToken,
      result: input.result,
      delaySeconds: input.delaySeconds,
      retryableFailure: input.retryableFailure,
      enabled: input.enabled,
      ...(input.operation === undefined
        ? {}
        : { operationId: input.operation.id }),
    });
    if (!completed) throw new Error("AUTOMATION_LEASE_LOST");
    return {
      automationId: lease.id,
      ...(input.operation === undefined
        ? {}
        : { operationId: input.operation.id }),
      result: input.result,
    };
  }

  async function processLease(
    lease: AutomationLease,
  ): Promise<SchedulerOutcome> {
    const started = Date.now();
    const pact = await options.certifiedRepository.getPact(lease.pactRecordId);
    if (pact === undefined) {
      return finish(lease, {
        result: "PACT_RECORD_MISSING",
        delaySeconds: 0,
        retryableFailure: false,
        enabled: false,
      });
    }
    let snapshot: PersistedChainSnapshot;
    try {
      snapshot = await options.arc.readSnapshot({
        pactEvaluator: pact.pactEvaluator,
        commerceContract: pact.commerceContract,
        jobId: pact.jobId,
      });
    } catch {
      const result = "ARC_READ_RETRYABLE";
      logger({
        role: "verifier",
        event: "verification_deferred",
        pactRecordId: pact.id,
        jobKey: pact.jobKey,
        chainId: pact.chainId.toString(),
        jobId: pact.jobId.toString(),
        reason: result,
        retryCount: lease.consecutiveRetryableFailures + 1,
        latencyMs: Date.now() - started,
      });
      return finish(lease, {
        result,
        delaySeconds: retryDelay(
          lease.consecutiveRetryableFailures,
          pollSeconds,
          maximumBackoffSeconds,
        ),
        retryableFailure: true,
        enabled: true,
      });
    }
    const check = eligibility(pact, snapshot, options);
    if (!check.eligible) {
      const terminal = [
        "AUTOMATION_INTEGRITY_MISMATCH",
        "ALREADY_COMPLETED",
        "AUTOMATION_EXPIRED",
      ].includes(check.code);
      return finish(lease, {
        result: check.code,
        delaySeconds: terminal ? 0 : pollSeconds,
        retryableFailure: false,
        enabled: !terminal,
      });
    }
    const operation = await options.certifiedRepository.enqueueManualOperation(
      pact.id,
      `automatic:${lease.id}:${lease.leaseToken}`,
    );
    const result = await options.orchestrator.processOperation(operation.id);
    const retryable = ["INDETERMINATE", "CHAIN_RETRYABLE"].includes(
      result.state,
    );
    const conditionFalse = result.state === "NOT_SATISFIED_RETRYABLE";
    const ready = result.state === "READY_TO_RELAY";
    const active = [
      "PENDING",
      "VERIFYING_GITHUB",
      "VERIFIED",
      "RECONCILING_CHAIN",
      "READY_TO_SIGN",
      "SIGNING",
    ].includes(result.state);
    const enabled =
      !ready &&
      ![
        "NOT_SATISFIED_TERMINAL",
        "CHAIN_INVALID",
        "ALREADY_ACCEPTED",
        "EXPIRED",
        "FAILED_DEFINITE",
      ].includes(result.state);
    const delaySeconds = retryable
      ? retryDelay(
          lease.consecutiveRetryableFailures,
          pollSeconds,
          maximumBackoffSeconds,
        )
      : conditionFalse || active
        ? pollSeconds
        : 0;
    logger({
      role: "verifier",
      event: "verification_processed",
      pactRecordId: pact.id,
      operationId: operation.id,
      jobKey: pact.jobKey,
      chainId: pact.chainId.toString(),
      jobId: pact.jobId.toString(),
      verificationResult: result.state,
      ...(result.code === undefined ? {} : { reason: result.code }),
      ...(result.attestationDigest === undefined
        ? {}
        : { attestationDigest: result.attestationDigest }),
      retryCount: retryable ? lease.consecutiveRetryableFailures + 1 : 0,
      latencyMs: Date.now() - started,
    });
    return finish(lease, {
      result: result.state,
      delaySeconds,
      retryableFailure: retryable,
      enabled,
      operation,
    });
  }

  return Object.freeze({
    async runOnce(): Promise<readonly SchedulerOutcome[]> {
      const leases = await options.automation.claimDue(
        options.workerId,
        options.batchSize,
        options.leaseSeconds,
      );
      const outcomes: SchedulerOutcome[] = [];
      for (const item of leases) outcomes.push(await processLease(item));
      return outcomes;
    },
  });
}
