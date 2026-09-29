import type {
  PostgresRelayRepository,
  ReadyToRelayArtifact,
  RelayIntentRecord,
  RelayState,
} from "@pact/database";
import type { Address } from "viem";
import type {
  RelayBroadcastTransport,
  RelayChainClient,
  RelayNetworkPreparation,
  RelayPreflight,
} from "./chain.js";
import { RelayRpcReadError } from "./chain.js";
import {
  decideRelayPreflight,
  reconcileRelayObservation,
} from "./reconcile.js";
import {
  buildPactRelayCalldata,
  preparePactRelayTransaction,
  type PactRelaySigner,
} from "./signer.js";

export interface RelayProcessResult {
  readonly intentId?: string;
  readonly state: RelayState | "IDLE" | "SENDER_BUSY" | "READ_RETRYABLE";
  readonly code?: string;
  readonly expectedTxHash?: string;
}

export interface PactRelayServiceOptions {
  readonly repository: RelayRepository;
  readonly chain: RelayChainClient;
  readonly transport: RelayBroadcastTransport;
  readonly signer: PactRelaySigner;
  readonly configuredChainId: bigint;
  readonly configuredPactEvaluator: Address;
  readonly configuredCommerceContract: Address;
}

export type RelayRepository = Pick<
  PostgresRelayRepository,
  | "listReadyToRelayArtifacts"
  | "getIntent"
  | "listIntents"
  | "recordTerminalBeforeNonce"
  | "reserveNonce"
  | "persistSignedTransaction"
  | "claimDispatch"
  | "transitionPreDispatch"
  | "recordBroadcastResult"
  | "transitionOutcome"
  | "recoverDispatching"
  | "findArtifactByIntent"
>;

function publicResult(intent: RelayIntentRecord): RelayProcessResult {
  return {
    intentId: intent.id,
    state: intent.state,
    ...(intent.code === null ? {} : { code: intent.code }),
    ...(intent.expectedTxHash === null
      ? {}
      : { expectedTxHash: intent.expectedTxHash }),
  };
}

export function createPactRelayService(options: PactRelayServiceOptions) {
  async function persistSigned(
    intent: RelayIntentRecord,
    artifact: ReadyToRelayArtifact,
    preparation: Exclude<RelayNetworkPreparation, { sufficientBalance: false }>,
  ): Promise<RelayIntentRecord> {
    if (intent.nonce === null)
      throw new Error("PREPARING relay intent has no reserved nonce");
    const calldata = buildPactRelayCalldata(artifact);
    const request = await options.chain.prepareExactRequest({
      chainId: options.configuredChainId,
      relayAddress: options.signer.address,
      pactEvaluator: options.configuredPactEvaluator,
      calldata,
      nonce: intent.nonce,
      preparation,
    });
    const prepared = preparePactRelayTransaction({
      artifact,
      request,
      relayAddress: options.signer.address,
      configuredChainId: options.configuredChainId,
      configuredPactEvaluator: options.configuredPactEvaluator,
      reservedNonce: intent.nonce,
    });
    const signed = await options.signer.signPactRelayTransaction(prepared);
    const persisted = await options.repository.persistSignedTransaction(
      intent.id,
      {
        calldata,
        serializedTransaction: signed.serializedTransaction,
        expectedTxHash: signed.expectedTxHash,
        transactionType: request.type,
        gasLimit: request.gas,
        ...(request.gasPrice === undefined
          ? {}
          : { gasPrice: request.gasPrice }),
        ...(request.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: request.maxFeePerGas }),
        ...(request.maxPriorityFeePerGas === undefined
          ? {}
          : { maxPriorityFeePerGas: request.maxPriorityFeePerGas }),
        preDispatchBlockNumber:
          intent.preDispatchBlockNumber ?? artifact.readyBlockNumber,
        preDispatchBlockHash:
          intent.preDispatchBlockHash ??
          (() => {
            throw new Error("PREPARING relay intent has no pre-dispatch block");
          })(),
      },
    );
    if (persisted === undefined)
      throw new Error("relay signing CAS ownership lost");
    return persisted;
  }

  async function preflightForIntent(
    intent: RelayIntentRecord,
    artifact: ReadyToRelayArtifact,
  ): Promise<
    | { readonly kind: "READY"; readonly preflight: RelayPreflight }
    | { readonly kind: "STOP"; readonly result: RelayProcessResult }
  > {
    let preflight;
    try {
      preflight = await options.chain.readPreflight(artifact);
    } catch (error) {
      if (error instanceof RelayRpcReadError)
        return {
          kind: "STOP",
          result: {
            intentId: intent.id,
            state: intent.state,
            code: error.code,
          },
        };
      throw error;
    }
    const decision = decideRelayPreflight({
      artifact,
      preflight,
      configuredChainId: options.configuredChainId,
      configuredPactEvaluator: options.configuredPactEvaluator,
      configuredCommerceContract: options.configuredCommerceContract,
    });
    if (decision.kind === "READY") return { kind: "READY", preflight };
    const transitioned = await options.repository.transitionPreDispatch({
      id: intent.id,
      expectedStates: ["PREPARING", "SIGNED"],
      state: decision.state,
      code: decision.code,
      ...(decision.outcome === undefined ? {} : { outcome: decision.outcome }),
    });
    return {
      kind: "STOP",
      result:
        transitioned === undefined
          ? { intentId: intent.id, state: intent.state, code: "RELAY_CAS_LOST" }
          : publicResult(transitioned),
    };
  }

  async function dispatchSigned(
    intent: RelayIntentRecord,
    artifact: ReadyToRelayArtifact,
  ): Promise<RelayProcessResult> {
    const preflight = await preflightForIntent(intent, artifact);
    if (preflight.kind === "STOP") return preflight.result;
    const dispatching = await options.repository.claimDispatch(intent.id);
    if (dispatching === undefined)
      return {
        intentId: intent.id,
        state: intent.state,
        code: "DISPATCH_CAS_LOST",
      };
    if (
      dispatching.serializedTransaction === null ||
      dispatching.expectedTxHash === null
    ) {
      throw new Error("DISPATCHING intent lacks durable transaction identity");
    }
    let returnedHash: `0x${string}`;
    try {
      returnedHash = await options.transport.sendRawTransaction(
        dispatching.serializedTransaction,
      );
    } catch {
      const unknown = await options.repository.recordBroadcastResult({
        id: dispatching.id,
        state: "BROADCAST_UNKNOWN",
        code: "RPC_BROADCAST_OUTCOME_UNKNOWN",
      });
      return unknown === undefined
        ? {
            intentId: dispatching.id,
            state: "DISPATCHING",
            code: "POST_DISPATCH_DATABASE_FAILURE",
            expectedTxHash: dispatching.expectedTxHash,
          }
        : publicResult(unknown);
    }
    if (returnedHash !== dispatching.expectedTxHash) {
      const integrity = await options.repository.recordBroadcastResult({
        id: dispatching.id,
        state: "INTEGRITY_FAILURE",
        code: "RPC_RETURNED_HASH_MISMATCH",
        returnedTxHash: returnedHash,
      });
      return integrity === undefined
        ? {
            intentId: dispatching.id,
            state: "DISPATCHING",
            code: "POST_DISPATCH_DATABASE_FAILURE",
            expectedTxHash: dispatching.expectedTxHash,
          }
        : publicResult(integrity);
    }
    let submitted: RelayIntentRecord | undefined;
    try {
      submitted = await options.repository.recordBroadcastResult({
        id: dispatching.id,
        state: "SUBMITTED",
        returnedTxHash: returnedHash,
      });
    } catch {
      return {
        intentId: dispatching.id,
        state: "DISPATCHING",
        code: "POST_DISPATCH_DATABASE_FAILURE",
        expectedTxHash: dispatching.expectedTxHash,
      };
    }
    if (submitted === undefined)
      return {
        intentId: dispatching.id,
        state: "DISPATCHING",
        code: "POST_DISPATCH_CAS_LOST",
        expectedTxHash: dispatching.expectedTxHash,
      };
    return publicResult(submitted);
  }

  async function resumePreparing(
    intent: RelayIntentRecord,
    artifact: ReadyToRelayArtifact,
  ): Promise<RelayProcessResult> {
    const checked = await preflightForIntent(intent, artifact);
    if (checked.kind === "STOP") return checked.result;
    const calldata = buildPactRelayCalldata(artifact);
    let preparation: RelayNetworkPreparation;
    try {
      preparation = await options.chain.simulateAndEstimate(
        artifact,
        options.signer.address,
        calldata,
        checked.preflight.snapshot,
      );
    } catch (error) {
      if (error instanceof RelayRpcReadError)
        return {
          intentId: intent.id,
          state: "PREPARING",
          code: error.code,
        };
      const failed = await options.repository.transitionPreDispatch({
        id: intent.id,
        expectedStates: ["PREPARING"],
        state: "PRECONDITION_FAILED",
        code: "SIMULATION_FAILED",
      });
      return failed === undefined
        ? { intentId: intent.id, state: "PREPARING", code: "RELAY_CAS_LOST" }
        : publicResult(failed);
    }
    if (!preparation.sufficientBalance) {
      const failed = await options.repository.transitionPreDispatch({
        id: intent.id,
        expectedStates: ["PREPARING"],
        state: "INSUFFICIENT_RELAY_GAS",
        code: "INSUFFICIENT_RELAY_GAS",
      });
      return failed === undefined
        ? { intentId: intent.id, state: "PREPARING", code: "RELAY_CAS_LOST" }
        : publicResult(failed);
    }
    const signed = await persistSigned(intent, artifact, preparation);
    return dispatchSigned(signed, artifact);
  }

  async function processNewArtifact(
    artifact: ReadyToRelayArtifact,
  ): Promise<RelayProcessResult> {
    let preflight;
    try {
      preflight = await options.chain.readPreflight(artifact);
    } catch (error) {
      return {
        state: "READ_RETRYABLE",
        code: error instanceof RelayRpcReadError ? error.code : "RPC_FAILURE",
      };
    }
    const decision = decideRelayPreflight({
      artifact,
      preflight,
      configuredChainId: options.configuredChainId,
      configuredPactEvaluator: options.configuredPactEvaluator,
      configuredCommerceContract: options.configuredCommerceContract,
    });
    if (decision.kind === "TERMINAL") {
      const terminal = await options.repository.recordTerminalBeforeNonce({
        artifact,
        relayAddress: options.signer.address,
        state: decision.state,
        code: decision.code,
        ...(decision.outcome === undefined
          ? {}
          : { outcome: decision.outcome }),
      });
      return publicResult(terminal);
    }
    const calldata = buildPactRelayCalldata(artifact);
    let preparation: RelayNetworkPreparation;
    try {
      preparation = await options.chain.simulateAndEstimate(
        artifact,
        options.signer.address,
        calldata,
        preflight.snapshot,
      );
    } catch (error) {
      if (error instanceof RelayRpcReadError)
        return {
          state: "READ_RETRYABLE",
          code: error.code,
        };
      const terminal = await options.repository.recordTerminalBeforeNonce({
        artifact,
        relayAddress: options.signer.address,
        state: "PRECONDITION_FAILED",
        code: "SIMULATION_FAILED",
      });
      return publicResult(terminal);
    }
    if (!preparation.sufficientBalance) {
      const terminal = await options.repository.recordTerminalBeforeNonce({
        artifact,
        relayAddress: options.signer.address,
        state: "INSUFFICIENT_RELAY_GAS",
        code: "INSUFFICIENT_RELAY_GAS",
      });
      return publicResult(terminal);
    }
    const reservation = await options.repository.reserveNonce({
      artifact,
      relayAddress: options.signer.address,
      preDispatchBlockNumber: preflight.snapshot.blockNumber,
      preDispatchBlockHash: preflight.snapshot.blockHash,
      readNonces: () => options.chain.readNonces(options.signer.address),
    });
    if (reservation.kind === "SENDER_BUSY")
      return {
        intentId: reservation.intent.id,
        state: "SENDER_BUSY",
        code: "ONE_UNRESOLVED_RELAY_PER_SENDER",
      };
    if (reservation.kind === "NONCE_DRIFT")
      return publicResult(reservation.intent);
    if (reservation.kind === "EXISTING") {
      const existing = reservation.intent;
      if (existing.state === "SIGNED")
        return dispatchSigned(existing, artifact);
      if (existing.state === "PREPARING")
        return resumePreparing(existing, artifact);
      return publicResult(existing);
    }
    const signed = await persistSigned(
      reservation.intent,
      artifact,
      preparation,
    );
    return dispatchSigned(signed, artifact);
  }

  async function reconcileOne(
    intent: RelayIntentRecord,
  ): Promise<RelayProcessResult> {
    const artifact = await options.repository.findArtifactByIntent(intent.id);
    if (artifact === undefined)
      return {
        intentId: intent.id,
        state: intent.state,
        code: "ARTIFACT_MISSING",
      };
    let observation;
    try {
      observation = await options.chain.observe(intent, artifact);
    } catch (error) {
      return {
        intentId: intent.id,
        state: intent.state,
        code: error instanceof RelayRpcReadError ? error.code : "RPC_FAILURE",
      };
    }
    const decision = reconcileRelayObservation({
      intent,
      artifact,
      observation,
    });
    const transitioned = await options.repository.transitionOutcome({
      id: intent.id,
      expectedStates: [intent.state as "SUBMITTED" | "BROADCAST_UNKNOWN"],
      state: decision.state,
      code: decision.code,
      retryable: decision.retryable,
      ...(decision.outcome === undefined ? {} : { outcome: decision.outcome }),
    });
    return transitioned === undefined
      ? { intentId: intent.id, state: intent.state, code: "RECONCILE_CAS_LOST" }
      : publicResult(transitioned);
  }

  return Object.freeze({
    async process(): Promise<RelayProcessResult> {
      const signed = await options.repository.listIntents(["SIGNED"], 1);
      if (signed[0] !== undefined) {
        const artifact = await options.repository.findArtifactByIntent(
          signed[0].id,
        );
        if (artifact === undefined)
          return {
            intentId: signed[0].id,
            state: "SIGNED",
            code: "ARTIFACT_MISSING",
          };
        return dispatchSigned(signed[0], artifact);
      }
      const preparing = await options.repository.listIntents(["PREPARING"], 1);
      if (preparing[0] !== undefined) {
        const artifact = await options.repository.findArtifactByIntent(
          preparing[0].id,
        );
        if (artifact === undefined)
          return {
            intentId: preparing[0].id,
            state: "PREPARING",
            code: "ARTIFACT_MISSING",
          };
        return resumePreparing(preparing[0], artifact);
      }
      const artifacts = await options.repository.listReadyToRelayArtifacts(1);
      return artifacts[0] === undefined
        ? { state: "IDLE" }
        : processNewArtifact(artifacts[0]);
    },

    async reconcile(limit = 10): Promise<readonly RelayProcessResult[]> {
      await options.repository.recoverDispatching(
        options.signer.address,
        options.configuredChainId,
      );
      const intents = await options.repository.listIntents(
        ["SUBMITTED", "BROADCAST_UNKNOWN"],
        limit,
      );
      const results: RelayProcessResult[] = [];
      for (const intent of intents) results.push(await reconcileOne(intent));
      return results;
    },
  });
}
