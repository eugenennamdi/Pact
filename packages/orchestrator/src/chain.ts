import type { PersistedChainSnapshot } from "@pact/database";
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";

export const DEFAULT_ARC_RPC_TIMEOUT_MS = 5_000;

const pactEvaluatorAbi = [
  {
    type: "function",
    name: "commerceContract",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "jobKey",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getBinding",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      { name: "exists", type: "bool" },
      {
        name: "binding",
        type: "tuple",
        components: [
          { name: "conditionHash", type: "bytes32" },
          { name: "completionDeadline", type: "uint64" },
          { name: "verifier", type: "address" },
          { name: "accepted", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isVerifierRevoked",
    stateMutability: "view",
    inputs: [{ name: "verifier", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const erc8183Abi = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "job",
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "status", type: "uint8" },
          { name: "provider", type: "address" },
          { name: "expiredAt", type: "uint48" },
          { name: "evaluator", type: "address" },
          { name: "submittedAt", type: "uint48" },
          { name: "budget", type: "uint256" },
          { name: "hook", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "providerAgentId", type: "uint256" },
          { name: "description", type: "string" },
          { name: "settledAmount", type: "uint256" },
          { name: "payoutReceiver", type: "address" },
        ],
      },
    ],
  },
] as const;

export class ArcReadError extends Error {
  readonly code: "RPC_TIMEOUT" | "RPC_FAILURE" | "RPC_INVALID_RESPONSE";
  readonly retryable = true;
  constructor(code: ArcReadError["code"]) {
    super(code);
    this.code = code;
  }
}

export interface ArcReadClient {
  readSnapshot(input: {
    readonly pactEvaluator: Address;
    readonly commerceContract: Address;
    readonly jobId: bigint;
  }): Promise<PersistedChainSnapshot>;
}

export interface ArcReadClientOptions {
  readonly rpcUrl: string;
  readonly timeoutMs?: number;
}

function classifyRpcError(error: unknown): ArcReadError {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || /timeout|timed out/i.test(error.message))
  ) {
    return new ArcReadError("RPC_TIMEOUT");
  }
  return new ArcReadError("RPC_FAILURE");
}

export function createArcReadClient(
  options: ArcReadClientOptions,
): ArcReadClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ARC_RPC_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30_000
  ) {
    throw new Error("Arc RPC timeout must be between 1 and 30000 milliseconds");
  }
  const client = createPublicClient({
    transport: http(options.rpcUrl, { retryCount: 0, timeout: timeoutMs }),
  });

  return Object.freeze({
    async readSnapshot(input: {
      readonly pactEvaluator: Address;
      readonly commerceContract: Address;
      readonly jobId: bigint;
    }): Promise<PersistedChainSnapshot> {
      try {
        const [runtimeChainId, block] = await Promise.all([
          client.getChainId(),
          client.getBlock({ blockTag: "latest" }),
        ]);
        if (block.hash === null) throw new ArcReadError("RPC_INVALID_RESPONSE");
        const blockNumber = block.number;
        const [commerce, jobKey, bindingResult, job] = await Promise.all([
          client.readContract({
            address: input.pactEvaluator,
            abi: pactEvaluatorAbi,
            functionName: "commerceContract",
            blockNumber,
          }),
          client.readContract({
            address: input.pactEvaluator,
            abi: pactEvaluatorAbi,
            functionName: "jobKey",
            args: [input.jobId],
            blockNumber,
          }),
          client.readContract({
            address: input.pactEvaluator,
            abi: pactEvaluatorAbi,
            functionName: "getBinding",
            args: [input.jobId],
            blockNumber,
          }),
          client.readContract({
            address: input.commerceContract,
            abi: erc8183Abi,
            functionName: "getJob",
            args: [input.jobId],
            blockNumber,
          }),
        ]);
        const [bindingExists, binding] = bindingResult;
        const verifierRevoked = await client.readContract({
          address: input.pactEvaluator,
          abi: pactEvaluatorAbi,
          functionName: "isVerifierRevoked",
          args: [binding.verifier],
          blockNumber,
        });
        return Object.freeze({
          blockNumber,
          blockHash: block.hash as Hex,
          blockTimestamp: block.timestamp,
          chainId: BigInt(runtimeChainId),
          pactEvaluator: getAddress(input.pactEvaluator),
          commerceContract: getAddress(commerce),
          jobId: input.jobId,
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
      } catch (error) {
        if (error instanceof ArcReadError) throw error;
        throw classifyRpcError(error);
      }
    },
  });
}
