import type {
  ExpiredAttestationRecoveryIdentity,
  ExpiredAttestationRecoveryPreflight,
  FreshReadyToRelayResult,
} from "../recovery.js";
import type { ExpiredUnsentRecoveryResult } from "@pact/database";
import {
  advanceControlledOperatorState,
  type ControlledOperatorState,
} from "./staged-operator.js";

interface RecoveryStateStore {
  load(): Promise<ControlledOperatorState | undefined>;
  save(state: ControlledOperatorState): Promise<void>;
}

interface RecoveryServiceBoundary {
  preflight(
    identity: ExpiredAttestationRecoveryIdentity,
  ): Promise<ExpiredAttestationRecoveryPreflight>;
  retireAndEnqueue(
    identity: ExpiredAttestationRecoveryIdentity,
    preflight: ExpiredAttestationRecoveryPreflight,
  ): Promise<ExpiredUnsentRecoveryResult>;
  completePhase4A(
    identity: ExpiredAttestationRecoveryIdentity,
    retirement: ExpiredUnsentRecoveryResult,
  ): Promise<FreshReadyToRelayResult>;
}

export type RecoveryConditionObservation =
  | { readonly status: "SATISFIED" }
  | { readonly status: "NOT_SATISFIED"; readonly reason?: string }
  | { readonly status: "INDETERMINATE"; readonly reason?: string };

export interface ExpiredRecoveryCoordinatorOptions {
  readonly stateStore: RecoveryStateStore;
  readonly service: RecoveryServiceBoundary;
  readonly observeCondition: (
    observedAt: bigint,
  ) => Promise<RecoveryConditionObservation>;
  readonly expectedManifestIdentity: ControlledOperatorState["manifestIdentity"];
  readonly expectedRepository: string;
  readonly expectedPullRequest: number;
  readonly expectedBaseBranch: string;
}

function assertStateIdentity(
  state: ControlledOperatorState,
  identity: ExpiredAttestationRecoveryIdentity,
  options: Pick<
    ExpiredRecoveryCoordinatorOptions,
    | "expectedManifestIdentity"
    | "expectedRepository"
    | "expectedPullRequest"
    | "expectedBaseBranch"
  >,
): void {
  if (
    state.manifestIdentity !== options.expectedManifestIdentity ||
    state.repository !== options.expectedRepository ||
    state.pullRequest !== options.expectedPullRequest ||
    state.baseBranch !== options.expectedBaseBranch ||
    state.network !== "arc-mainnet" ||
    state.chainId !== identity.expectedChainId.toString() ||
    state.pactId !== identity.pactRecordId ||
    state.jobId !== identity.expectedJobId.toString() ||
    state.jobKey !== identity.expectedJobKey ||
    state.conditionHash !== identity.expectedConditionHash ||
    state.completionDeadline !==
      identity.expectedCompletionDeadline.toString() ||
    state.commerceContract !== identity.expectedCommerceContract ||
    state.pactEvaluator !== identity.expectedPactEvaluator ||
    state.verifier !== identity.expectedVerifier ||
    state.relay !== identity.relayAddress
  )
    throw new Error("RECOVERY_OPERATOR_STATE_IDENTITY_MISMATCH");
}

export function createExpiredRecoveryCoordinator(
  options: ExpiredRecoveryCoordinatorOptions,
) {
  return Object.freeze({
    async run(
      identity: ExpiredAttestationRecoveryIdentity,
    ): Promise<FreshReadyToRelayResult> {
      let state = await options.stateStore.load();
      if (state === undefined)
        throw new Error("RECOVERY_OPERATOR_STATE_MISSING");
      assertStateIdentity(state, identity, options);
      if (
        ![
          "SUBMITTED",
          "AWAITING_CONDITION",
          "CONDITION_SATISFIED",
          "PHASE4A_ENQUEUED",
          "READY_TO_RELAY",
        ].includes(state.stage)
      )
        throw new Error(`RECOVERY_OPERATOR_STAGE_INVALID:${state.stage}`);

      // This validates the historical out-of-band READY_TO_RELAY operation and
      // its expired attestation before any operator-state advancement.
      const preflight = await options.service.preflight(identity);

      if (preflight.historical.shape === "SHAPE_B") {
        if (
          state.stage === "SUBMITTED" ||
          state.stage === "AWAITING_CONDITION"
        ) {
          throw new Error(
            "RECOVERY_OPERATOR_STAGE_INVALID: post-retirement DB requires stage CONDITION_SATISFIED or later",
          );
        }
      } else if (
        state.stage === "PHASE4A_ENQUEUED" ||
        state.stage === "READY_TO_RELAY"
      ) {
        throw new Error(
          "RECOVERY_OPERATOR_STAGE_INVALID: stage requires post-retirement Shape B",
        );
      }

      if (state.stage === "SUBMITTED") {
        state = advanceControlledOperatorState(state, "AWAITING_CONDITION");
        await options.stateStore.save(state);
      }
      if (state.stage === "AWAITING_CONDITION") {
        const observation = await options.observeCondition(
          preflight.snapshot.blockTimestamp,
        );
        if (observation.status === "NOT_SATISFIED") {
          throw new Error(
            `RECOVERY_CONDITION_NOT_SATISFIED${observation.reason ? `:${observation.reason}` : ""}`,
          );
        }
        if (observation.status === "INDETERMINATE") {
          throw new Error(
            `RECOVERY_CONDITION_INDETERMINATE${observation.reason ? `:${observation.reason}` : ""}`,
          );
        }
        if (observation.status !== "SATISFIED") {
          throw new Error(
            `RECOVERY_CONDITION_UNKNOWN_STATUS:${(observation as { status: string }).status}`,
          );
        }
        state = advanceControlledOperatorState(state, "CONDITION_SATISFIED");
        await options.stateStore.save(state);
      }

      const retirement = await options.service.retireAndEnqueue(
        identity,
        preflight,
      );
      if (state.stage === "CONDITION_SATISFIED") {
        state = advanceControlledOperatorState(state, "PHASE4A_ENQUEUED", {
          operationId: retirement.recoveryOperationId,
        });
        await options.stateStore.save(state);
      } else if (
        state.operationId !== retirement.recoveryOperationId &&
        state.stage !== "SUBMITTED" &&
        state.stage !== "AWAITING_CONDITION"
      ) {
        throw new Error("RECOVERY_OPERATOR_OPERATION_MISMATCH");
      }
      if (
        state.stage !== "PHASE4A_ENQUEUED" &&
        state.stage !== "READY_TO_RELAY"
      )
        throw new Error(`RECOVERY_OPERATOR_STAGE_INVALID:${state.stage}`);

      const fresh = await options.service.completePhase4A(identity, retirement);
      if (state.stage === "PHASE4A_ENQUEUED") {
        state = advanceControlledOperatorState(state, "READY_TO_RELAY");
        await options.stateStore.save(state);
      }
      return fresh;
    },
  });
}
