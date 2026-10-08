import {
  createPublicClient,
  getAddress,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import {
  loadCertifiedProductDeployment,
  verifyCertifiedProductDeployment,
  type ProductDeployment,
} from "./deployment";
import { DEFAULT_PRODUCT_NETWORK, type ProductNetworkConfig } from "./network";
import {
  productErc8183Abi,
  productEvaluatorAbi,
  productUsdcAbi,
} from "./wallet-abi";

export interface ProductBlockContext {
  readonly chainId: bigint;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly timestamp: bigint;
  readonly gasPrice: bigint;
}

export interface ProductJob {
  readonly client: Address;
  readonly status: number;
  readonly provider: Address;
  readonly expiredAt: bigint;
  readonly evaluator: Address;
  readonly submittedAt: bigint;
  readonly budget: bigint;
  readonly hook: Address;
  readonly paymentToken: Address;
  readonly providerAgentId: bigint;
  readonly description: string;
  readonly settledAmount: bigint;
  readonly payoutReceiver: Address;
}

export interface ProductBinding {
  readonly exists: boolean;
  readonly conditionHash: `0x${string}`;
  readonly completionDeadline: bigint;
  readonly verifier: Address;
  readonly accepted: boolean;
}

export interface ProductTransactionEvidence {
  readonly chainId: bigint;
  readonly hash: `0x${string}`;
  readonly from: Address;
  readonly to: Address | null;
  readonly value: bigint;
  readonly input: Hex;
  readonly receiptStatus: "success" | "reverted";
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly logs: readonly unknown[];
}

export interface ProductGasDiagnostics {
  readonly estimatedGas: bigint | null;
  readonly gasPrice: bigint;
  readonly nativeBalance: bigint;
  readonly erc20BalanceBaseUnits: bigint;
  readonly requiredNativeBalance: bigint | null;
  readonly readiness: "READY" | "INSUFFICIENT_BALANCE" | "UNKNOWN";
}

export interface UnsignedCall {
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly applicationAmountBaseUnits?: bigint;
}

export interface ProductChainClient {
  readonly deployment: ProductDeployment;
  verifyDeployment(): Promise<void>;
  readContext(): Promise<ProductBlockContext>;
  readBlockHash(blockNumber: bigint): Promise<`0x${string}`>;
  readJob(jobId: bigint, blockNumber?: bigint): Promise<ProductJob>;
  readBinding(jobId: bigint, blockNumber?: bigint): Promise<ProductBinding>;
  readAllowance(owner: Address, blockNumber?: bigint): Promise<bigint>;
  diagnoseGas(
    call: UnsignedCall,
    context: ProductBlockContext,
  ): Promise<ProductGasDiagnostics>;
  readTransactionEvidence(
    hash: `0x${string}`,
  ): Promise<ProductTransactionEvidence>;
  jobIdFromCreatedEvent(evidence: ProductTransactionEvidence): bigint;
}

const NATIVE_SCALE = 1_000_000_000_000n;
const GAS_MARGIN_NUMERATOR = 125n;
const GAS_MARGIN_DENOMINATOR = 100n;
const FEE_MARGIN_NUMERATOR = 150n;
const FEE_MARGIN_DENOMINATOR = 100n;

interface ProductJobResponse {
  readonly client: Address;
  readonly status: number;
  readonly provider: Address;
  readonly expiredAt: number;
  readonly evaluator: Address;
  readonly submittedAt: number;
  readonly budget: bigint;
  readonly hook: Address;
  readonly paymentToken: Address;
  readonly providerAgentId: bigint;
  readonly description: string;
  readonly settledAmount: bigint;
  readonly payoutReceiver: Address;
}

function canonicalJob(raw: ProductJobResponse): ProductJob {
  return Object.freeze({
    client: getAddress(raw.client),
    status: Number(raw.status),
    provider: getAddress(raw.provider),
    expiredAt: BigInt(raw.expiredAt),
    evaluator: getAddress(raw.evaluator),
    submittedAt: BigInt(raw.submittedAt),
    budget: raw.budget,
    hook: getAddress(raw.hook),
    paymentToken: getAddress(raw.paymentToken),
    providerAgentId: raw.providerAgentId,
    description: raw.description,
    settledAmount: raw.settledAmount,
    payoutReceiver: getAddress(raw.payoutReceiver),
  });
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not found|could not be found|unknown transaction/i.test(error.message)
  );
}

export function createProductChainClient(input: {
  readonly rpcUrl: string;
  readonly network?: ProductNetworkConfig;
  readonly timeoutMs?: number;
}): ProductChainClient {
  const network = input.network ?? DEFAULT_PRODUCT_NETWORK;
  const deployment = loadCertifiedProductDeployment(network);
  const client = createPublicClient({
    transport: http(input.rpcUrl, {
      retryCount: 0,
      timeout: input.timeoutMs ?? 15_000,
    }),
  });
  return Object.freeze({
    deployment,
    async verifyDeployment(): Promise<void> {
      await verifyCertifiedProductDeployment(input.rpcUrl, network);
    },
    async readContext(): Promise<ProductBlockContext> {
      const [chainId, block, gasPrice] = await Promise.all([
        client.getChainId(),
        client.getBlock({ blockTag: "latest" }),
        client.getGasPrice(),
      ]);
      if (BigInt(chainId) !== network.chainId) throw new Error("WRONG_CHAIN");
      if (block.hash === null) throw new Error("ARC_BLOCK_NOT_CANONICAL");
      return Object.freeze({
        chainId: BigInt(chainId),
        blockNumber: block.number,
        blockHash: block.hash,
        timestamp: block.timestamp,
        gasPrice,
      });
    },
    async readBlockHash(blockNumber: bigint): Promise<`0x${string}`> {
      const block = await client.getBlock({ blockNumber });
      if (block.hash === null) throw new Error("ARC_BLOCK_NOT_CANONICAL");
      return block.hash;
    },
    async readJob(jobId: bigint, blockNumber?: bigint): Promise<ProductJob> {
      const raw = (await client.readContract({
        address: deployment.commerce,
        abi: productErc8183Abi,
        functionName: "getJob",
        args: [jobId],
        ...(blockNumber === undefined ? {} : { blockNumber }),
      })) as unknown as ProductJobResponse;
      return canonicalJob(raw);
    },
    async readBinding(
      jobId: bigint,
      blockNumber?: bigint,
    ): Promise<ProductBinding> {
      const raw = (await client.readContract({
        address: deployment.evaluator,
        abi: productEvaluatorAbi,
        functionName: "getBinding",
        args: [jobId],
        ...(blockNumber === undefined ? {} : { blockNumber }),
      })) as unknown as readonly [
        boolean,
        {
          readonly conditionHash: `0x${string}`;
          readonly completionDeadline: bigint;
          readonly verifier: Address;
          readonly accepted: boolean;
        },
      ];
      return Object.freeze({
        exists: raw[0],
        conditionHash: raw[1].conditionHash,
        completionDeadline: raw[1].completionDeadline,
        verifier: getAddress(raw[1].verifier),
        accepted: raw[1].accepted,
      });
    },
    async readAllowance(owner: Address, blockNumber?: bigint): Promise<bigint> {
      return client.readContract({
        address: deployment.usdc,
        abi: productUsdcAbi,
        functionName: "allowance",
        args: [owner, deployment.commerce],
        ...(blockNumber === undefined ? {} : { blockNumber }),
      });
    },
    async diagnoseGas(
      call: UnsignedCall,
      context: ProductBlockContext,
    ): Promise<ProductGasDiagnostics> {
      const [nativeBalance, erc20Balance] = await Promise.all([
        client.getBalance({
          address: call.from,
          blockNumber: context.blockNumber,
        }),
        client.readContract({
          address: deployment.usdc,
          abi: productUsdcAbi,
          functionName: "balanceOf",
          args: [call.from],
          blockNumber: context.blockNumber,
        }),
      ]);
      let estimatedGas: bigint | null = null;
      try {
        estimatedGas = await client.estimateGas({
          account: call.from,
          to: call.to,
          value: call.value,
          data: call.data,
        });
      } catch {
        // A wallet simulation remains authoritative; expose estimation uncertainty.
      }
      const applicationNative =
        (call.applicationAmountBaseUnits ?? 0n) * NATIVE_SCALE;
      const requiredNativeBalance =
        estimatedGas === null
          ? null
          : applicationNative +
            (((estimatedGas * GAS_MARGIN_NUMERATOR) / GAS_MARGIN_DENOMINATOR) *
              context.gasPrice *
              FEE_MARGIN_NUMERATOR) /
              FEE_MARGIN_DENOMINATOR;
      return Object.freeze({
        estimatedGas,
        gasPrice: context.gasPrice,
        nativeBalance,
        erc20BalanceBaseUnits: erc20Balance,
        requiredNativeBalance,
        readiness:
          requiredNativeBalance === null
            ? "UNKNOWN"
            : nativeBalance >= requiredNativeBalance
              ? "READY"
              : "INSUFFICIENT_BALANCE",
      });
    },
    async readTransactionEvidence(
      hash: `0x${string}`,
    ): Promise<ProductTransactionEvidence> {
      let transaction;
      try {
        transaction = await client.getTransaction({ hash });
      } catch (error) {
        if (isNotFound(error)) throw new Error("TRANSACTION_NOT_FOUND");
        throw error;
      }
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash });
      } catch (error) {
        if (isNotFound(error)) throw new Error("TRANSACTION_PENDING");
        throw error;
      }
      const chainId = BigInt(await client.getChainId());
      if (chainId !== network.chainId) throw new Error("WRONG_CHAIN");
      if (receipt.blockHash === null)
        throw new Error("ARC_RECEIPT_NOT_CANONICAL");
      const canonicalBlock = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      if (
        canonicalBlock.hash === null ||
        canonicalBlock.hash !== receipt.blockHash ||
        transaction.blockNumber !== receipt.blockNumber
      ) {
        throw new Error("ARC_RECEIPT_BLOCK_MISMATCH");
      }
      return Object.freeze({
        chainId,
        hash,
        from: getAddress(transaction.from),
        to: transaction.to === null ? null : getAddress(transaction.to),
        value: transaction.value,
        input: transaction.input,
        receiptStatus: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        logs: receipt.logs,
      });
    },
    jobIdFromCreatedEvent(evidence: ProductTransactionEvidence): bigint {
      const events = parseEventLogs({
        abi: productErc8183Abi,
        logs: evidence.logs as never,
        eventName: "JobCreated",
        strict: true,
      });
      const matching = events.filter(
        (event) => getAddress(event.address) === deployment.commerce,
      );
      if (matching.length !== 1 || matching[0] === undefined)
        throw new Error("CANONICAL_JOB_CREATED_EVENT_MISSING");
      const args = matching[0].args as { readonly jobId?: bigint };
      if (args.jobId === undefined || args.jobId <= 0n)
        throw new Error("CANONICAL_JOB_ID_INVALID");
      return args.jobId;
    },
  });
}
