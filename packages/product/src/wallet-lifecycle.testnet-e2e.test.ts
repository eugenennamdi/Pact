import {
  hashPactJobIdentity,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import { createGitHubPullRequestClient } from "@pact/verifier/github";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  CanonicalPactRegistrar,
  CanonicalPactRegistration,
} from "./canonical-link";
import { ARC_TESTNET_PRODUCT_NETWORK } from "./network";
import { InMemoryProductRepository } from "./repository";
import { createDraft, readPublicPact } from "./service";
import type { PactDraft } from "./types";
import { createProductChainClient } from "./wallet-chain";
import {
  confirmWalletAction,
  prepareWalletAction,
  type WalletLifecycleRuntime,
} from "./wallet-lifecycle";

const TESTNET_CHAIN_ID = ARC_TESTNET_PRODUCT_NETWORK.chainId;

const enabled = process.env.PACT_PRODUCT_TESTNET_E2E === "1";
const describeTestnet = enabled ? describe : describe.skip;
const MAINNET_ADDRESSES = new Set(
  [
    "0x1f320aF0E8F11b89eD88ddD8C549B39F6081954b",
    "0xd857612A587DF68b0C2627208Bdd9F934695A231",
    "0x49a5F99Cdf8b9683459A467e9b71a554495Ecc52",
  ].map((address) => address.toLowerCase()),
);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function key(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is invalid`);
  return value as Hex;
}

class TestnetRegistrar implements CanonicalPactRegistrar {
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

describeTestnet("Phase 6D controlled Arc Testnet product E2E", () => {
  it(
    "stops at canonical Submitted / AWAITING_CONDITION",
    async () => {
      const rpcUrl = required("PACT_PRODUCT_TESTNET_RPC_URL");
      const rpc = new URL(rpcUrl);
      if (rpc.protocol !== "https:" || rpc.hostname !== "rpc.testnet.arc.io")
        throw new Error("TESTNET_RPC_NOT_ALLOWLISTED");
      const clientAccount = privateKeyToAccount(
        key("PACT_E2E_CLIENT_PRIVATE_KEY"),
      );
      const providerAccount = privateKeyToAccount(
        key("PACT_E2E_PROVIDER_PRIVATE_KEY"),
      );
      if (
        MAINNET_ADDRESSES.has(clientAccount.address.toLowerCase()) ||
        MAINNET_ADDRESSES.has(providerAccount.address.toLowerCase())
      ) {
        throw new Error("MAINNET_IDENTITY_FORBIDDEN");
      }
      const repositoryName = required("PACT_PHASE6D_GITHUB_REPOSITORY");
      const pullRequest = Number(required("PACT_PHASE6D_GITHUB_PULL_REQUEST"));
      if (
        repositoryName !== "eugenennamdi/pact-arc-demo" ||
        !Number.isSafeInteger(pullRequest) ||
        pullRequest <= 0
      ) {
        throw new Error("TESTNET_GITHUB_CONDITION_INVALID");
      }
      const amount = required("PACT_PHASE6D_AMOUNT_BASE_UNITS");
      if (amount !== "1000") throw new Error("TESTNET_BUDGET_NOT_TINY");

      const chainDefinition = defineChain({
        id: Number(TESTNET_CHAIN_ID),
        name: "Arc Testnet",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
      const publicClient = createPublicClient({
        chain: chainDefinition,
        transport: http(rpcUrl, { retryCount: 1, timeout: 20_000 }),
      });
      if (BigInt(await publicClient.getChainId()) !== TESTNET_CHAIN_ID)
        throw new Error("WRONG_CHAIN");
      const [clientBalance, providerBalance] = await Promise.all([
        publicClient.getBalance({ address: clientAccount.address }),
        publicClient.getBalance({ address: providerAccount.address }),
      ]);
      if (clientBalance === 0n)
        throw new Error(
          `TESTNET_FUNDING_REQUIRED:client:${clientAccount.address}`,
        );
      if (providerBalance === 0n)
        throw new Error(
          `TESTNET_FUNDING_REQUIRED:provider:${providerAccount.address}`,
        );

      const wallet = createWalletClient({
        chain: chainDefinition,
        transport: http(rpcUrl, { retryCount: 0, timeout: 20_000 }),
      });
      const chain = createProductChainClient({
        rpcUrl,
        timeoutMs: 20_000,
        network: ARC_TESTNET_PRODUCT_NETWORK,
      });
      const github = createGitHubPullRequestClient();
      const repository = new InMemoryProductRepository();
      const created = await createDraft({
        repository,
        github,
        sessionWallet: clientAccount.address,
        idempotencyKey: `testnet-draft-${pullRequest}`,
        network: ARC_TESTNET_PRODUCT_NETWORK,
        request: {
          repository: repositoryName,
          pullRequest,
          provider: providerAccount.address,
          amount: "0.001",
        },
      });
      const runtime: WalletLifecycleRuntime = {
        network: ARC_TESTNET_PRODUCT_NETWORK,
        repository,
        github,
        chain,
        registrar: new TestnetRegistrar(),
      };
      const transactions: Record<string, Hex32> = {};
      const runAction = async (
        path: string,
        account: typeof clientAccount,
        ordinal: number,
      ) => {
        const plan = await prepareWalletAction({
          runtime,
          slug: created.publicSlug,
          actionPath: path,
          sessionWallet: account.address,
          idempotencyKey: `testnet-action-${ordinal.toString().padStart(2, "0")}-${pullRequest}`,
        });
        if (plan.result !== "PREPARED")
          throw new Error(`${path} unexpectedly required no transaction`);
        if (plan.fee.readiness === "INSUFFICIENT_BALANCE") {
          throw new Error(
            `TESTNET_FUNDING_REQUIRED:${path}:${account.address}:${plan.fee.nativeBalance}:${plan.fee.requiredNativeBalance ?? "unknown"}`,
          );
        }
        const hash = await wallet.sendTransaction({
          account,
          to: plan.to,
          value: BigInt(plan.value),
          data: plan.data,
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 120_000,
        });
        if (receipt.status !== "success")
          throw new Error(`${path} reverted on Arc Testnet`);
        const confirmed = await confirmWalletAction({
          runtime,
          slug: created.publicSlug,
          actionPath: path,
          sessionWallet: account.address,
          transactionHash: hash,
        });
        transactions[path] = hash;
        return confirmed;
      };

      const createResult = await runAction("create-job", clientAccount, 1);
      await runAction("bind-condition", clientAccount, 2);
      await runAction("set-budget", providerAccount, 3);
      await runAction("approve-usdc", clientAccount, 4);
      await runAction("fund", clientAccount, 5);
      const submitResult = await runAction("submit", providerAccount, 6);
      const jobId = BigInt(createResult.jobId);
      const [job, binding, projection] = await Promise.all([
        chain.readJob(jobId),
        chain.readBinding(jobId),
        readPublicPact({ repository, slug: created.publicSlug }),
      ]);
      expect(job.status).toBe(2);
      expect(binding.exists).toBe(true);
      expect(binding.conditionHash).toBe(created.conditionHash);
      expect(binding.accepted).toBe(false);
      expect(submitResult.productStatus).toBe("AWAITING_CONDITION");
      expect(projection.status).toBe("AWAITING_CONDITION");
      process.stdout.write(
        `${JSON.stringify({ status: "PASS", repository: repositoryName, pullRequest, client: clientAccount.address, provider: providerAccount.address, jobId: jobId.toString(), conditionHash: created.conditionHash, transactions, finalJobStatus: job.status, bindingExists: binding.exists, bindingAccepted: binding.accepted, productStatus: projection.status })}\n`,
      );
    },
    10 * 60_000,
  );
});
