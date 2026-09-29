import type {
  PersistedChainSnapshot,
  ReadyToRelayArtifact,
  RelayIntentRecord,
} from "@pact/database";
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { prepareTransactionRequest, sendRawTransaction } from "viem/actions";
import {
  pactCompletionAcceptedEvent,
  pactRelayAbi,
  relayErc8183Abi,
} from "./abi.js";
import type { ExactRelayTransactionRequest } from "./signer.js";

export const RELAY_GAS_MARGIN_NUMERATOR = 110n;
export const RELAY_GAS_MARGIN_DENOMINATOR = 100n;

export class RelayRpcReadError extends Error {
  readonly retryable = true;
  constructor(
    readonly code: "RPC_TIMEOUT" | "RPC_FAILURE" | "RPC_INVALID_RESPONSE",
  ) {
    super(code);
  }
}

export class RelaySimulationError extends Error {
  constructor() {
    super("SIMULATION_FAILED");
  }
}

export interface RelayCompletionEvent {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly logIndex: number;
  readonly jobKey: `0x${string}`;
  readonly jobId: bigint;
  readonly evidenceHash: `0x${string}`;
  readonly conditionHash: `0x${string}`;
  readonly attestationDigest: `0x${string}`;
  readonly verifier: Address;
  readonly relayer: Address;
}

export interface RelayPreflight {
  readonly snapshot: PersistedChainSnapshot;
  readonly completionEvents: readonly RelayCompletionEvent[];
}

export type RelayNetworkPreparation =
  | {
      readonly sufficientBalance: true;
      readonly gas: bigint;
      readonly type: "eip1559";
      readonly maxFeePerGas: bigint;
      readonly maxPriorityFeePerGas: bigint;
      readonly requiredBalance: bigint;
      readonly actualBalance: bigint;
    }
  | {
      readonly sufficientBalance: true;
      readonly gas: bigint;
      readonly type: "legacy";
      readonly gasPrice: bigint;
      readonly requiredBalance: bigint;
      readonly actualBalance: bigint;
    }
  | {
      readonly sufficientBalance: false;
      readonly gas: bigint;
      readonly type: "eip1559" | "legacy";
      readonly requiredBalance: bigint;
      readonly actualBalance: bigint;
    };

export interface RelayReceiptObservation {
  readonly transactionFound: boolean;
  readonly receipt?: TransactionReceipt;
  readonly canonicalEventReceipt?: TransactionReceipt;
  readonly completionEvents: readonly RelayCompletionEvent[];
  readonly snapshot: PersistedChainSnapshot;
  readonly latestNonce: number;
  readonly pendingNonce: number;
}

export interface RelayChainClient {
  readPreflight(artifact: ReadyToRelayArtifact): Promise<RelayPreflight>;
  simulateAndEstimate(
    artifact: ReadyToRelayArtifact,
    relayAddress: Address,
    calldata: Hex,
    snapshot: PersistedChainSnapshot,
  ): Promise<RelayNetworkPreparation>;
  readNonces(relayAddress: Address): Promise<{
    readonly latest: number;
    readonly pending: number;
  }>;
  prepareExactRequest(input: {
    readonly chainId: bigint;
    readonly relayAddress: Address;
    readonly pactEvaluator: Address;
    readonly calldata: Hex;
    readonly nonce: number;
    readonly preparation: Exclude<
      RelayNetworkPreparation,
      { sufficientBalance: false }
    >;
  }): Promise<ExactRelayTransactionRequest>;
  observe(
    intent: RelayIntentRecord,
    artifact: ReadyToRelayArtifact,
  ): Promise<RelayReceiptObservation>;
}

export interface RelayBroadcastTransport {
  sendRawTransaction(serializedTransaction: Hex): Promise<`0x${string}`>;
}

function classify(error: unknown): RelayRpcReadError {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || /timeout|timed out/i.test(error.message))
  ) {
    return new RelayRpcReadError("RPC_TIMEOUT");
  }
  return new RelayRpcReadError("RPC_FAILURE");
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Transaction(NotFound|ReceiptNotFound)|could not be found/i.test(
      `${error.name}:${error.message}`,
    )
  );
}

function asEvent(log: {
  readonly transactionHash: Hex | null;
  readonly blockNumber: bigint | null;
  readonly blockHash: Hex | null;
  readonly logIndex: number | null;
  readonly args: {
    readonly jobKey?: Hex;
    readonly jobId?: bigint;
    readonly evidenceHash?: Hex;
    readonly conditionHash?: Hex;
    readonly attestationDigest?: Hex;
    readonly verifier?: Address;
    readonly relayer?: Address;
  };
}): RelayCompletionEvent {
  const { args } = log;
  if (
    log.transactionHash === null ||
    log.blockNumber === null ||
    log.blockHash === null ||
    log.logIndex === null ||
    args.jobKey === undefined ||
    args.jobId === undefined ||
    args.evidenceHash === undefined ||
    args.conditionHash === undefined ||
    args.attestationDigest === undefined ||
    args.verifier === undefined ||
    args.relayer === undefined
  ) {
    throw new RelayRpcReadError("RPC_INVALID_RESPONSE");
  }
  return Object.freeze({
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    logIndex: log.logIndex,
    jobKey: args.jobKey,
    jobId: args.jobId,
    evidenceHash: args.evidenceHash,
    conditionHash: args.conditionHash,
    attestationDigest: args.attestationDigest,
    verifier: getAddress(args.verifier),
    relayer: getAddress(args.relayer),
  });
}

export function createRelayChainClient(options: {
  readonly rpcUrl: string;
  readonly timeoutMs?: number;
}): RelayChainClient & { readonly broadcast: RelayBroadcastTransport } {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000)
    throw new Error(
      "relay RPC timeout must be between 1 and 30000 milliseconds",
    );
  const client = createPublicClient({
    transport: http(options.rpcUrl, { retryCount: 0, timeout: timeoutMs }),
  });

  async function readSnapshot(
    artifact: ReadyToRelayArtifact,
  ): Promise<PersistedChainSnapshot> {
    const [runtimeChainId, block] = await Promise.all([
      client.getChainId(),
      client.getBlock({ blockTag: "latest" }),
    ]);
    if (block.hash === null)
      throw new RelayRpcReadError("RPC_INVALID_RESPONSE");
    const blockNumber = block.number;
    const [commerce, jobKey, bindingResult, job] = await Promise.all([
      client.readContract({
        address: artifact.pact.pactEvaluator,
        abi: pactRelayAbi,
        functionName: "commerceContract",
        blockNumber,
      }),
      client.readContract({
        address: artifact.pact.pactEvaluator,
        abi: pactRelayAbi,
        functionName: "jobKey",
        args: [artifact.pact.jobId],
        blockNumber,
      }),
      client.readContract({
        address: artifact.pact.pactEvaluator,
        abi: pactRelayAbi,
        functionName: "getBinding",
        args: [artifact.pact.jobId],
        blockNumber,
      }),
      client.readContract({
        address: artifact.pact.commerceContract,
        abi: relayErc8183Abi,
        functionName: "getJob",
        args: [artifact.pact.jobId],
        blockNumber,
      }),
    ]);
    const [bindingExists, binding] = bindingResult;
    const verifierRevoked = await client.readContract({
      address: artifact.pact.pactEvaluator,
      abi: pactRelayAbi,
      functionName: "isVerifierRevoked",
      args: [binding.verifier],
      blockNumber,
    });
    return Object.freeze({
      blockNumber,
      blockHash: block.hash,
      blockTimestamp: block.timestamp,
      chainId: BigInt(runtimeChainId),
      pactEvaluator: artifact.pact.pactEvaluator,
      commerceContract: getAddress(commerce),
      jobId: artifact.pact.jobId,
      jobKey,
      bindingExists,
      bindingConditionHash: binding.conditionHash,
      bindingCompletionDeadline: BigInt(binding.completionDeadline),
      bindingVerifier: getAddress(binding.verifier),
      bindingAccepted: binding.accepted,
      verifierRevoked,
      jobClient: getAddress(job.client),
      jobProvider: getAddress(job.provider),
      jobEvaluator: getAddress(job.evaluator),
      jobStatus: Number(job.status),
      jobExpiredAt: BigInt(job.expiredAt),
    });
  }

  async function events(
    artifact: ReadyToRelayArtifact,
    toBlock: bigint,
  ): Promise<readonly RelayCompletionEvent[]> {
    if (artifact.readyBlockNumber > toBlock)
      throw new RelayRpcReadError("RPC_INVALID_RESPONSE");
    const logs = await client.getLogs({
      address: artifact.pact.pactEvaluator,
      event: pactCompletionAcceptedEvent,
      args: {
        jobKey: artifact.pact.jobKey,
        jobId: artifact.pact.jobId,
      },
      fromBlock: artifact.readyBlockNumber,
      toBlock,
      strict: true,
    });
    return logs
      .map(asEvent)
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? a.logIndex - b.logIndex
          : a.blockNumber < b.blockNumber
            ? -1
            : 1,
      );
  }

  async function readNonces(relayAddress: Address) {
    const [latest, pending] = await Promise.all([
      client.getTransactionCount({ address: relayAddress, blockTag: "latest" }),
      client.getTransactionCount({
        address: relayAddress,
        blockTag: "pending",
      }),
    ]);
    return Object.freeze({ latest, pending });
  }

  const chain: RelayChainClient = {
    async readPreflight(artifact) {
      try {
        const snapshot = await readSnapshot(artifact);
        return Object.freeze({
          snapshot,
          completionEvents: await events(artifact, snapshot.blockNumber),
        });
      } catch (error) {
        if (error instanceof RelayRpcReadError) throw error;
        throw classify(error);
      }
    },

    async simulateAndEstimate(artifact, relayAddress, calldata, snapshot) {
      try {
        await client.simulateContract({
          address: artifact.pact.pactEvaluator,
          abi: pactRelayAbi,
          functionName: "completeWithAttestation",
          args: [
            {
              commerceContract: artifact.attestation.commerceContract,
              jobId: artifact.attestation.jobId,
              conditionHash: artifact.attestation.conditionHash,
              evidenceHash: artifact.attestation.evidenceHash,
              satisfiedAt: artifact.attestation.satisfiedAt,
              verifiedAt: artifact.attestation.verifiedAt,
              validUntil: artifact.attestation.validUntil,
            },
            artifact.attestation.signature,
          ],
          account: relayAddress,
          blockNumber: snapshot.blockNumber,
        });
        const [estimatedGas, block, balance] = await Promise.all([
          client.estimateGas({
            account: relayAddress,
            to: artifact.pact.pactEvaluator,
            data: calldata,
            value: 0n,
            blockNumber: snapshot.blockNumber,
          }),
          client.getBlock({ blockNumber: snapshot.blockNumber }),
          client.getBalance({
            address: relayAddress,
            blockNumber: snapshot.blockNumber,
          }),
        ]);
        const gas =
          (estimatedGas * RELAY_GAS_MARGIN_NUMERATOR +
            RELAY_GAS_MARGIN_DENOMINATOR -
            1n) /
          RELAY_GAS_MARGIN_DENOMINATOR;
        if (typeof block.baseFeePerGas === "bigint") {
          const fees = await client.estimateFeesPerGas({
            chain: null,
            type: "eip1559",
          });
          const requiredBalance = gas * fees.maxFeePerGas;
          if (balance < requiredBalance)
            return Object.freeze({
              sufficientBalance: false as const,
              gas,
              type: "eip1559" as const,
              requiredBalance,
              actualBalance: balance,
            });
          return Object.freeze({
            sufficientBalance: true as const,
            gas,
            type: "eip1559" as const,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            requiredBalance,
            actualBalance: balance,
          });
        }
        const gasPrice = await client.getGasPrice();
        const requiredBalance = gas * gasPrice;
        if (balance < requiredBalance)
          return Object.freeze({
            sufficientBalance: false as const,
            gas,
            type: "legacy" as const,
            requiredBalance,
            actualBalance: balance,
          });
        return Object.freeze({
          sufficientBalance: true as const,
          gas,
          type: "legacy" as const,
          gasPrice,
          requiredBalance,
          actualBalance: balance,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /revert|execution reverted/i.test(error.message)
        )
          throw new RelaySimulationError();
        throw classify(error);
      }
    },

    async readNonces(relayAddress) {
      try {
        return await readNonces(relayAddress);
      } catch (error) {
        throw classify(error);
      }
    },

    async prepareExactRequest(input) {
      if (
        input.chainId > BigInt(Number.MAX_SAFE_INTEGER) ||
        input.chainId <= 0n
      )
        throw new Error("relay chainId is outside viem transaction range");
      const feeFields =
        input.preparation.type === "eip1559"
          ? {
              type: "eip1559" as const,
              maxFeePerGas: input.preparation.maxFeePerGas,
              maxPriorityFeePerGas: input.preparation.maxPriorityFeePerGas,
            }
          : {
              type: "legacy" as const,
              gasPrice: input.preparation.gasPrice,
            };
      const request = await prepareTransactionRequest(client, {
        account: input.relayAddress,
        chain: null,
        chainId: Number(input.chainId),
        to: input.pactEvaluator,
        value: 0n,
        data: input.calldata,
        nonce: input.nonce,
        gas: input.preparation.gas,
        ...feeFields,
        parameters: [],
      });
      if (
        request.chainId !== Number(input.chainId) ||
        request.to === undefined ||
        request.to === null ||
        getAddress(request.to) !== getAddress(input.pactEvaluator) ||
        request.value !== 0n ||
        request.data !== input.calldata ||
        request.nonce !== input.nonce ||
        request.gas !== input.preparation.gas
      )
        throw new Error("viem mutated an exact relay transaction field");
      return Object.freeze({
        chainId: Number(input.chainId),
        from: getAddress(input.relayAddress),
        to: getAddress(input.pactEvaluator),
        value: 0n,
        data: input.calldata,
        nonce: input.nonce,
        gas: input.preparation.gas,
        ...feeFields,
      });
    },

    async observe(intent, artifact) {
      if (intent.expectedTxHash === null)
        throw new Error("relay intent has no expected transaction hash");
      try {
        const snapshot = await readSnapshot(artifact);
        const [completionEvents, nonces, transactionFound, receipt] =
          await Promise.all([
            events(artifact, snapshot.blockNumber),
            readNonces(intent.relayAddress),
            client
              .getTransaction({ hash: intent.expectedTxHash })
              .then(() => true)
              .catch((error: unknown) => {
                if (isNotFound(error)) return false;
                throw error;
              }),
            client
              .getTransactionReceipt({ hash: intent.expectedTxHash })
              .catch((error: unknown) => {
                if (isNotFound(error)) return undefined;
                throw error;
              }),
          ]);
        const latestEvent = completionEvents.at(-1);
        const canonicalEventReceipt =
          latestEvent !== undefined &&
          latestEvent.transactionHash !== intent.expectedTxHash
            ? await client
                .getTransactionReceipt({ hash: latestEvent.transactionHash })
                .catch((error: unknown) => {
                  if (isNotFound(error)) return undefined;
                  throw error;
                })
            : undefined;
        return Object.freeze({
          transactionFound,
          ...(receipt === undefined ? {} : { receipt }),
          ...(canonicalEventReceipt === undefined
            ? {}
            : { canonicalEventReceipt }),
          completionEvents,
          snapshot,
          latestNonce: nonces.latest,
          pendingNonce: nonces.pending,
        });
      } catch (error) {
        if (error instanceof RelayRpcReadError) throw error;
        throw classify(error);
      }
    },
  };

  return Object.freeze({
    ...chain,
    broadcast: Object.freeze({
      sendRawTransaction: async (serializedTransaction: Hex) =>
        sendRawTransaction(client, { serializedTransaction }),
    }),
  });
}
