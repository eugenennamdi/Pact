import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashPactJobIdentity,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type {
  CanonicalPactRegistrar,
  CanonicalPactRegistration,
} from "./canonical-link";
import { loadCertifiedProductDeployment } from "./deployment";
import { ARC_TESTNET_PRODUCT_NETWORK } from "./network";
import { readPublicPact, createDraft } from "./service";
import { InMemoryProductRepository } from "./repository";
import type { PactDraft } from "./types";
import {
  confirmWalletAction,
  prepareWalletAction,
  type PreparedTransactionPlan,
  type WalletLifecycleRuntime,
} from "./wallet-lifecycle";
import {
  productErc8183Abi,
  productEvaluatorAbi,
  productUsdcAbi,
} from "./wallet-abi";
import type {
  ProductBinding,
  ProductBlockContext,
  ProductChainClient,
  ProductGasDiagnostics,
  ProductJob,
  ProductTransactionEvidence,
  UnsignedCall,
} from "./wallet-chain";

const TESTNET_CHAIN_ID = ARC_TESTNET_PRODUCT_NETWORK.chainId;

const enabled = process.env.PACT_PRODUCT_LOCAL_E2E === "1";
const describeLocal = enabled ? describe : describe.skip;
const ANVIL =
  process.env.PACT_ANVIL_BIN?.trim() ||
  process.env.ANVIL_BIN?.trim() ||
  "anvil";
const PORT = Number(process.env.PACT_PRODUCT_LOCAL_E2E_PORT ?? "58648");
const RPC_URL = `http://127.0.0.1:${PORT}`;
const BUDGET = 1_000n;

interface Artifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

async function artifact(path: string): Promise<Artifact> {
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    readonly abi: Abi;
    readonly bytecode: { readonly object: Hex };
  };
  return { abi: raw.abi, bytecode: raw.bytecode.object };
}

async function waitForRpc(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) return;
    } catch {
      // Anvil is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("local product Anvil did not become ready");
}

function jobFromRaw(raw: {
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
}): ProductJob {
  return {
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
  };
}

class LocalRegistrar implements CanonicalPactRegistrar {
  async register(input: {
    readonly draft: PactDraft;
    readonly commerce: Address;
    readonly evaluator: Address;
    readonly jobId: bigint;
    readonly completionDeadline: bigint;
  }): Promise<CanonicalPactRegistration> {
    return {
      pactRecordId: input.draft.id,
      jobKey: hashPactJobIdentity(
        normalizePactJobIdentity({
          chainId: input.draft.chainId,
          commerceContract: input.commerce,
          jobId: input.jobId,
        }),
      ) as Hex32,
    };
  }
}

describeLocal("Phase 6D local product wallet lifecycle E2E", () => {
  let anvil: ChildProcess | undefined;

  beforeAll(async () => {
    anvil = spawn(
      ANVIL,
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(PORT),
        "--chain-id",
        TESTNET_CHAIN_ID.toString(),
      ],
      { stdio: "ignore" },
    );
    await waitForRpc();
  }, 15_000);

  afterAll(() => {
    anvil?.kill("SIGTERM");
  });

  it("uses product prepare and confirm services through Submitted", async () => {
    const chainDefinition = defineChain({
      id: Number(TESTNET_CHAIN_ID),
      name: "Pact Product Local",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    });
    const publicClient = createPublicClient({
      chain: chainDefinition,
      transport: http(RPC_URL, { retryCount: 0 }),
    });
    const wallet = createWalletClient({
      chain: chainDefinition,
      transport: http(RPC_URL, { retryCount: 0 }),
    });
    const accounts = await wallet.getAddresses();
    const admin = getAddress(accounts[0]!);
    const client = getAddress(accounts[1]!);
    const provider = getAddress(accounts[2]!);
    const verifier = getAddress(accounts[3]!);
    const root = fileURLToPath(
      new URL("../../contracts/out/", import.meta.url),
    );
    const [erc8183, proxyArtifact, evaluatorArtifact, tokenArtifact] =
      await Promise.all([
        artifact(resolve(root, "ERC8183.sol/ERC8183.json")),
        artifact(
          resolve(
            root,
            "PactManagedERC8183Proxy.sol/PactManagedERC8183Proxy.json",
          ),
        ),
        artifact(resolve(root, "PactEvaluator.sol/PactEvaluator.json")),
        artifact(resolve(root, "MockArcUSDC.sol/MockArcUSDC.json")),
      ]);
    const deploy = async (
      abi: Abi,
      bytecode: Hex,
      args: readonly unknown[] = [],
    ): Promise<Address> => {
      const hash = await wallet.deployContract({
        account: admin,
        abi,
        bytecode,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.contractAddress === null)
        throw new Error("local deployment address missing");
      return getAddress(receipt.contractAddress);
    };
    const implementation = await deploy(erc8183.abi, erc8183.bytecode);
    const initialization = encodeFunctionData({
      abi: erc8183.abi,
      functionName: "initialize",
      args: [admin, admin],
    });
    const commerce = await deploy(proxyArtifact.abi, proxyArtifact.bytecode, [
      implementation,
      initialization,
    ]);
    const evaluator = await deploy(
      evaluatorArtifact.abi,
      evaluatorArtifact.bytecode,
      [commerce, verifier, admin],
    );
    const usdc = await deploy(tokenArtifact.abi, tokenArtifact.bytecode, [
      client,
      BUDGET,
    ]);
    const { request: allowRequest } = await publicClient.simulateContract({
      account: admin,
      address: commerce,
      abi: erc8183.abi,
      functionName: "setPaymentTokenAllowed",
      args: [usdc, true],
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract(allowRequest),
    });

    const certified = loadCertifiedProductDeployment(
      ARC_TESTNET_PRODUCT_NETWORK,
    );
    const deployment = {
      ...certified,
      commerce,
      evaluator,
      usdc,
      verifier,
    };
    const chain: ProductChainClient = {
      deployment,
      async verifyDeployment() {},
      async readContext(): Promise<ProductBlockContext> {
        const [block, gasPrice] = await Promise.all([
          publicClient.getBlock(),
          publicClient.getGasPrice(),
        ]);
        if (block.hash === null) throw new Error("local block missing hash");
        return {
          chainId: TESTNET_CHAIN_ID,
          blockNumber: block.number,
          blockHash: block.hash,
          timestamp: block.timestamp,
          gasPrice,
        };
      },
      async readBlockHash(blockNumber: bigint) {
        const block = await publicClient.getBlock({ blockNumber });
        if (block.hash === null) throw new Error("local block missing hash");
        return block.hash;
      },
      async readJob(jobId: bigint): Promise<ProductJob> {
        return jobFromRaw(
          (await publicClient.readContract({
            address: commerce,
            abi: productErc8183Abi,
            functionName: "getJob",
            args: [jobId],
          })) as unknown as Parameters<typeof jobFromRaw>[0],
        );
      },
      async readBinding(jobId: bigint): Promise<ProductBinding> {
        const raw = (await publicClient.readContract({
          address: evaluator,
          abi: productEvaluatorAbi,
          functionName: "getBinding",
          args: [jobId],
        })) as readonly [
          boolean,
          {
            readonly conditionHash: Hex32;
            readonly completionDeadline: bigint;
            readonly verifier: Address;
            readonly accepted: boolean;
          },
        ];
        return {
          exists: raw[0],
          conditionHash: raw[1].conditionHash,
          completionDeadline: raw[1].completionDeadline,
          verifier: getAddress(raw[1].verifier),
          accepted: raw[1].accepted,
        };
      },
      async readAllowance(owner: Address): Promise<bigint> {
        return publicClient.readContract({
          address: usdc,
          abi: productUsdcAbi,
          functionName: "allowance",
          args: [owner, commerce],
        });
      },
      async diagnoseGas(
        call: UnsignedCall,
        context: ProductBlockContext,
      ): Promise<ProductGasDiagnostics> {
        const [estimatedGas, nativeBalance, erc20BalanceBaseUnits] =
          await Promise.all([
            publicClient.estimateGas({
              account: call.from,
              to: call.to,
              value: call.value,
              data: call.data,
            }),
            publicClient.getBalance({ address: call.from }),
            publicClient.readContract({
              address: usdc,
              abi: productUsdcAbi,
              functionName: "balanceOf",
              args: [call.from],
            }),
          ]);
        return {
          estimatedGas,
          gasPrice: context.gasPrice,
          nativeBalance,
          erc20BalanceBaseUnits,
          requiredNativeBalance: estimatedGas * context.gasPrice,
          readiness: "READY",
        };
      },
      async readTransactionEvidence(
        hash: Hex32,
      ): Promise<ProductTransactionEvidence> {
        const [transaction, receipt] = await Promise.all([
          publicClient.getTransaction({ hash }),
          publicClient.getTransactionReceipt({ hash }),
        ]);
        return {
          chainId: TESTNET_CHAIN_ID,
          hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          input: transaction.input,
          receiptStatus: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          logs: receipt.logs,
        };
      },
      jobIdFromCreatedEvent(evidence: ProductTransactionEvidence): bigint {
        const events = parseEventLogs({
          abi: productErc8183Abi,
          logs: evidence.logs as never,
          eventName: "JobCreated",
          strict: true,
        });
        if (events.length !== 1 || events[0] === undefined)
          throw new Error("local JobCreated event missing");
        return (events[0].args as { readonly jobId: bigint }).jobId;
      },
    };
    const github: GitHubPullRequestClient = {
      async getPullRequest(repository, pullRequest) {
        return {
          ok: true,
          value: {
            number: pullRequest,
            state: "open",
            merged: false,
            mergedAt: null,
            mergeCommitSha: null,
            baseRepository: repository,
            baseBranch: "main",
            privateRepository: false,
          },
        };
      },
      async checkPullRequestMerged() {
        return { ok: true, value: { merged: false } };
      },
    };
    const repository = new InMemoryProductRepository();
    const created = await createDraft({
      repository,
      github,
      sessionWallet: client,
      idempotencyKey: "local-draft-key-01",
      network: ARC_TESTNET_PRODUCT_NETWORK,
      request: {
        repository: "pact-local/product",
        pullRequest: 1,
        provider,
        amount: "0.001",
      },
      now: new Date(Number((await publicClient.getBlock()).timestamp) * 1_000),
    });
    const runtime: WalletLifecycleRuntime = {
      network: ARC_TESTNET_PRODUCT_NETWORK,
      repository,
      github,
      chain,
      registrar: new LocalRegistrar(),
    };
    const transactions: Record<string, Hex32> = {};
    const runAction = async (
      path: string,
      signer: Address,
      ordinal: number,
    ) => {
      const plan = await prepareWalletAction({
        runtime,
        slug: created.publicSlug,
        actionPath: path,
        sessionWallet: signer,
        idempotencyKey: `local-action-${ordinal.toString().padStart(2, "0")}`,
      });
      if (plan.result !== "PREPARED")
        throw new Error(`${path} unexpectedly required no transaction`);
      const hash = await wallet.sendTransaction({
        account: signer,
        to: plan.to,
        value: BigInt(plan.value),
        data: plan.data,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const result = await confirmWalletAction({
        runtime,
        slug: created.publicSlug,
        actionPath: path,
        sessionWallet: signer,
        transactionHash: hash,
      });
      transactions[path] = hash;
      return { plan: plan as PreparedTransactionPlan, result };
    };
    const create = await runAction("create-job", client, 1);
    const jobId = BigInt(create.result.jobId);
    await runAction("bind-condition", client, 2);
    await runAction("set-budget", provider, 3);
    await runAction("approve-usdc", client, 4);
    await runAction("fund", client, 5);
    const submit = await runAction("submit", provider, 6);
    const job = await chain.readJob(jobId);
    const binding = await chain.readBinding(jobId);
    const projection = await readPublicPact({
      repository,
      slug: created.publicSlug,
    });
    expect(job.status).toBe(2);
    expect(binding.exists).toBe(true);
    expect(binding.accepted).toBe(false);
    expect(submit.result.productStatus).toBe("AWAITING_CONDITION");
    expect(projection.status).toBe("AWAITING_CONDITION");
    process.stdout.write(
      `${JSON.stringify({ status: "PASS", jobId: jobId.toString(), conditionHash: created.conditionHash, client, provider, transactions, finalJobStatus: job.status, bindingAccepted: binding.accepted, productStatus: projection.status })}\n`,
    );
  }, 60_000);
});
