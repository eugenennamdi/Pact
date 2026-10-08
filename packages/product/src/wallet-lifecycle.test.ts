import {
  GITHUB_PROVIDER,
  PR_MERGED_EVENT,
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { describe, expect, it } from "vitest";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import type {
  CanonicalPactRegistrar,
  CanonicalPactRegistration,
} from "./canonical-link";
import { loadCertifiedProductDeployment } from "./deployment";
import {
  ARC_MAINNET_PRODUCT_NETWORK,
  ARC_TESTNET_PRODUCT_NETWORK,
} from "./network";
import { InMemoryProductRepository } from "./repository";
import type { PactDraft, ProductRepository } from "./types";
import {
  confirmWalletAction,
  prepareWalletAction,
  type PreparedTransactionPlan,
  type WalletLifecycleRuntime,
} from "./wallet-lifecycle";
import { ZERO_ADDRESS } from "./wallet-abi";
import type {
  ProductBinding,
  ProductBlockContext,
  ProductChainClient,
  ProductGasDiagnostics,
  ProductJob,
  ProductTransactionEvidence,
  UnsignedCall,
} from "./wallet-chain";

const TESTNET_DEPLOYMENT = loadCertifiedProductDeployment(
  ARC_TESTNET_PRODUCT_NETWORK,
);
const TESTNET_CHAIN_ID = ARC_TESTNET_PRODUCT_NETWORK.chainId;
const TESTNET_COMMERCE_ADDRESS = TESTNET_DEPLOYMENT.commerce;
const TESTNET_EVALUATOR_ADDRESS = TESTNET_DEPLOYMENT.evaluator;
const TESTNET_USDC_ADDRESS = TESTNET_DEPLOYMENT.usdc;
const TESTNET_VERIFIER_ADDRESS = TESTNET_DEPLOYMENT.verifier;

const CLIENT = getAddress("0x1111111111111111111111111111111111111111");
const PROVIDER = getAddress("0x2222222222222222222222222222222222222222");
const OTHER = getAddress("0x3333333333333333333333333333333333333333");
const JOB_ID = 91n;
const BLOCK_HASH = `0x${"44".repeat(32)}` as Hex32;
const CONTEXT: ProductBlockContext = {
  chainId: TESTNET_CHAIN_ID,
  blockNumber: 70_000_000n,
  blockHash: BLOCK_HASH,
  timestamp: 2_000_000_000n,
  gasPrice: 20_000_000_000n,
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

function openJob(overrides: Partial<ProductJob> = {}): ProductJob {
  return {
    client: CLIENT,
    status: 0,
    provider: PROVIDER,
    expiredAt: CONTEXT.timestamp + 21_600n,
    evaluator: getAddress(TESTNET_EVALUATOR_ADDRESS),
    submittedAt: 0n,
    budget: 0n,
    hook: getAddress(ZERO_ADDRESS),
    paymentToken: getAddress(ZERO_ADDRESS),
    providerAgentId: 0n,
    description: "Pact PR_MERGED eugenennamdi/pact-arc-demo#9",
    settledAmount: 0n,
    payoutReceiver: getAddress(ZERO_ADDRESS),
    ...overrides,
  };
}

class FakeChain implements ProductChainClient {
  readonly deployment = TESTNET_DEPLOYMENT;
  context = { ...CONTEXT };
  job = openJob();
  binding: ProductBinding = {
    exists: false,
    conditionHash: `0x${"00".repeat(32)}`,
    completionDeadline: 0n,
    verifier: getAddress(ZERO_ADDRESS),
    accepted: false,
  };
  allowance = 0n;
  deploymentError: Error | undefined;
  evidence = new Map<Hex32, ProductTransactionEvidence | Error>();
  createdJobId = JOB_ID;
  createdEventValid = true;
  preparedBlockHash: `0x${string}` = BLOCK_HASH;

  async verifyDeployment(): Promise<void> {
    if (this.deploymentError !== undefined) throw this.deploymentError;
  }

  async readContext(): Promise<ProductBlockContext> {
    return this.context;
  }

  async readBlockHash(): Promise<`0x${string}`> {
    return this.preparedBlockHash;
  }

  async readJob(): Promise<ProductJob> {
    return this.job;
  }

  async readBinding(): Promise<ProductBinding> {
    return this.binding;
  }

  async readAllowance(): Promise<bigint> {
    return this.allowance;
  }

  async diagnoseGas(call: UnsignedCall): Promise<ProductGasDiagnostics> {
    const required =
      (call.applicationAmountBaseUnits ?? 0n) * 1_000_000_000_000n +
      31_500n * CONTEXT.gasPrice;
    return {
      estimatedGas: 21_000n,
      gasPrice: CONTEXT.gasPrice,
      nativeBalance: 10n ** 21n,
      erc20BalanceBaseUnits: 1_000_000_000n,
      requiredNativeBalance: required,
      readiness: "READY",
    };
  }

  async readTransactionEvidence(
    hash: Hex32,
  ): Promise<ProductTransactionEvidence> {
    const value = this.evidence.get(hash);
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error("TRANSACTION_NOT_FOUND");
    return value;
  }

  jobIdFromCreatedEvent(): bigint {
    if (!this.createdEventValid)
      throw new Error("CANONICAL_JOB_CREATED_EVENT_MISSING");
    return this.createdJobId;
  }
}

class FakeRegistrar implements CanonicalPactRegistrar {
  calls = 0;
  async register(input: {
    readonly draft: PactDraft;
    readonly commerce: Address;
    readonly evaluator: Address;
    readonly jobId: bigint;
    readonly completionDeadline: bigint;
  }): Promise<CanonicalPactRegistration> {
    this.calls += 1;
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

async function fixture(): Promise<{
  readonly runtime: WalletLifecycleRuntime;
  readonly repository: InMemoryProductRepository;
  readonly chain: FakeChain;
  readonly registrar: FakeRegistrar;
  readonly draft: PactDraft;
}> {
  const repository = new InMemoryProductRepository();
  const condition = normalizeGithubPrMergedCondition({
    provider: GITHUB_PROVIDER,
    repository: "eugenennamdi/pact-arc-demo",
    pullRequest: 9,
    baseBranch: "main",
    event: PR_MERGED_EVENT,
  });
  const created = await repository.createDraft({
    network: ARC_TESTNET_PRODUCT_NETWORK.id,
    chainId: ARC_TESTNET_PRODUCT_NETWORK.chainId,
    creatingWallet: CLIENT,
    providerAddress: PROVIDER,
    githubRepository: condition.repository,
    githubPullRequest: condition.pullRequest,
    amountBaseUnits: 1_000n,
    condition,
    conditionHash: hashGithubPrMergedCondition(condition) as Hex32,
    idempotencyKey: "draft-key-0001",
    canonicalRequestHash: `0x${"55".repeat(32)}`,
  });
  if (created.kind === "CONFLICT") throw new Error("fixture conflict");
  const chain = new FakeChain();
  const registrar = new FakeRegistrar();
  return {
    runtime: {
      network: ARC_TESTNET_PRODUCT_NETWORK,
      repository,
      github,
      chain,
      registrar,
    },
    repository,
    chain,
    registrar,
    draft: created.draft,
  };
}

function txHash(ordinal: number): Hex32 {
  return `0x${ordinal.toString(16).padStart(64, "0")}` as Hex32;
}

function evidence(
  hash: Hex32,
  plan: PreparedTransactionPlan,
  overrides: Partial<ProductTransactionEvidence> = {},
): ProductTransactionEvidence {
  return {
    chainId: TESTNET_CHAIN_ID,
    hash,
    from: plan.requiredSigner,
    to: plan.to,
    value: BigInt(plan.value),
    input: plan.data,
    receiptStatus: "success",
    blockNumber: CONTEXT.blockNumber + 1n,
    blockHash: `0x${"66".repeat(32)}`,
    logs: [],
    ...overrides,
  };
}

async function prepare(
  runtime: WalletLifecycleRuntime,
  slug: string,
  actionPath: string,
  wallet: Address,
  key: string,
): Promise<PreparedTransactionPlan> {
  const result = await prepareWalletAction({
    runtime,
    slug,
    actionPath,
    sessionWallet: wallet,
    idempotencyKey: key,
  });
  if (result.result !== "PREPARED")
    throw new Error("expected transaction plan");
  return result;
}

async function confirm(
  runtime: WalletLifecycleRuntime,
  slug: string,
  actionPath: string,
  wallet: Address,
  hash: Hex32,
) {
  return confirmWalletAction({
    runtime,
    slug,
    actionPath,
    sessionWallet: wallet,
    transactionHash: hash,
  });
}

async function confirmCreate(
  state: Awaited<ReturnType<typeof fixture>>,
): Promise<PreparedTransactionPlan> {
  const plan = await prepare(
    state.runtime,
    state.draft.publicSlug,
    "create-job",
    CLIENT,
    "create-key-0001",
  );
  const hash = txHash(1);
  state.chain.evidence.set(hash, evidence(hash, plan));
  state.chain.job = openJob({
    expiredAt: BigInt(plan.deadlines?.expiredAt ?? "0"),
  });
  await confirm(
    state.runtime,
    state.draft.publicSlug,
    "create-job",
    CLIENT,
    hash,
  );
  return plan;
}

async function confirmBind(
  state: Awaited<ReturnType<typeof fixture>>,
): Promise<void> {
  const plan = await prepare(
    state.runtime,
    state.draft.publicSlug,
    "bind-condition",
    CLIENT,
    "bind-key-0001",
  );
  state.chain.binding = {
    exists: true,
    conditionHash: state.draft.conditionHash,
    completionDeadline: BigInt(plan.deadlines?.completionDeadline ?? "0"),
    verifier: getAddress(TESTNET_VERIFIER_ADDRESS),
    accepted: false,
  };
  const hash = txHash(2);
  state.chain.evidence.set(hash, evidence(hash, plan));
  await confirm(
    state.runtime,
    state.draft.publicSlug,
    "bind-condition",
    CLIENT,
    hash,
  );
}

async function confirmBudget(
  state: Awaited<ReturnType<typeof fixture>>,
): Promise<void> {
  const plan = await prepare(
    state.runtime,
    state.draft.publicSlug,
    "set-budget",
    PROVIDER,
    "budget-key-0001",
  );
  state.chain.job = openJob({
    expiredAt: state.chain.job.expiredAt,
    budget: 1_000n,
    paymentToken: getAddress(TESTNET_USDC_ADDRESS),
  });
  const hash = txHash(3);
  state.chain.evidence.set(hash, evidence(hash, plan));
  await confirm(
    state.runtime,
    state.draft.publicSlug,
    "set-budget",
    PROVIDER,
    hash,
  );
}

async function confirmApproval(
  state: Awaited<ReturnType<typeof fixture>>,
): Promise<void> {
  const plan = await prepare(
    state.runtime,
    state.draft.publicSlug,
    "approve-usdc",
    CLIENT,
    "approve-key-0001",
  );
  state.chain.allowance = 1_000n;
  const hash = txHash(4);
  state.chain.evidence.set(hash, evidence(hash, plan));
  await confirm(
    state.runtime,
    state.draft.publicSlug,
    "approve-usdc",
    CLIENT,
    hash,
  );
}

async function confirmFund(
  state: Awaited<ReturnType<typeof fixture>>,
): Promise<void> {
  const plan = await prepare(
    state.runtime,
    state.draft.publicSlug,
    "fund",
    CLIENT,
    "fund-key-helper-01",
  );
  state.chain.job = { ...state.chain.job, status: 1 };
  const hash = txHash(31);
  state.chain.evidence.set(hash, evidence(hash, plan));
  await confirm(state.runtime, state.draft.publicSlug, "fund", CLIENT, hash);
}

describe("Phase 6D allowlisted wallet lifecycle", () => {
  it("blocks Mainnet transaction preparation before repository or chain access", async () => {
    const state = await fixture();
    await expect(
      prepareWalletAction({
        runtime: {
          ...state.runtime,
          network: ARC_MAINNET_PRODUCT_NETWORK,
        },
        slug: state.draft.publicSlug,
        actionPath: "create-job",
        sessionWallet: CLIENT,
        idempotencyKey: "mainnet-prepare-blocked-01",
      }),
    ).rejects.toMatchObject({
      code: "MAINNET_PRODUCT_MIGRATION_INCOMPLETE",
      status: 503,
    });
  });

  it("prepares and confirms all six actions through Submitted", async () => {
    const state = await fixture();
    const createPlan = await confirmCreate(state);
    expect(createPlan.to).toBe(getAddress(TESTNET_COMMERCE_ADDRESS));
    expect(createPlan.value).toBe("0");
    expect(createPlan.deadlines).toEqual({
      completionDeadline: (CONTEXT.timestamp + 7_200n).toString(),
      expiredAt: (CONTEXT.timestamp + 21_600n).toString(),
    });
    expect(createPlan.calldataHash).toBe(keccak256(createPlan.data));
    expect(state.registrar.calls).toBe(1);

    await confirmBind(state);
    await confirmBudget(state);
    await confirmApproval(state);

    const fundPlan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "fund",
      CLIENT,
      "fund-key-0001",
    );
    expect(fundPlan.fee.sharedUnderlyingBalance).toBe(true);
    expect(fundPlan.fee.requiredNativeBalance).not.toBeNull();
    state.chain.job = { ...state.chain.job, status: 1 };
    const fundHash = txHash(5);
    state.chain.evidence.set(fundHash, evidence(fundHash, fundPlan));
    const funded = await confirm(
      state.runtime,
      state.draft.publicSlug,
      "fund",
      CLIENT,
      fundHash,
    );
    expect(funded.productStatus).toBe("AWAITING_PROVIDER");

    const submitPlan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "submit",
      PROVIDER,
      "submit-key-0001",
    );
    state.chain.job = { ...state.chain.job, status: 2 };
    const submitHash = txHash(6);
    state.chain.evidence.set(submitHash, evidence(submitHash, submitPlan));
    const submitted = await confirm(
      state.runtime,
      state.draft.publicSlug,
      "submit",
      PROVIDER,
      submitHash,
    );
    expect(submitted.canonicalJobStatus).toBe(2);
    expect(submitted.productStatus).toBe("AWAITING_CONDITION");

    const projection = await state.repository.getPublicProjection(
      state.draft.publicSlug,
    );
    expect(projection?.walletActions).toHaveLength(6);
    expect(projection?.chainJobStatus).toBe(2);
  });

  it.each([
    ["create-job", PROVIDER, "WRONG_CLIENT_WALLET"],
    ["set-budget", CLIENT, "WRONG_PROVIDER_WALLET"],
    ["submit", CLIENT, "WRONG_PROVIDER_WALLET"],
  ] as const)("rejects the wrong signer for %s", async (path, wallet, code) => {
    const state = await fixture();
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: path,
        sessionWallet: wallet,
        idempotencyKey: "wrong-wallet-01",
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects unsupported actions and out-of-order preparation", async () => {
    const state = await fixture();
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "arbitrary-call",
        sessionWallet: CLIENT,
        idempotencyKey: "arbitrary-key-01",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ACTION" });
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "bind-condition",
        sessionWallet: CLIENT,
        idempotencyKey: "order-key-00001",
      }),
    ).rejects.toMatchObject({ code: "ACTION_ORDER_REQUIRES_CREATE_JOB" });
  });

  it("rejects a tampered persisted condition hash before chain preparation", async () => {
    const state = await fixture();
    const tampered = Object.freeze({
      ...state.draft,
      conditionHash: `0x${"99".repeat(32)}` as Hex32,
    });
    const repository = new Proxy(state.repository, {
      get(target, property) {
        if (property === "getDraftBySlug")
          return async () => Promise.resolve(tampered);
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ProductRepository;
    await expect(
      prepareWalletAction({
        runtime: { ...state.runtime, repository },
        slug: state.draft.publicSlug,
        actionPath: "create-job",
        sessionWallet: CLIENT,
        idempotencyKey: "tampered-key-001",
      }),
    ).rejects.toMatchObject({ code: "DRAFT_INTEGRITY_MISMATCH" });
  });

  it("replays the same preparation and rejects semantic idempotency conflicts", async () => {
    const state = await fixture();
    const first = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "replay-key-0001",
    );
    const replay = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "replay-key-0001",
    );
    expect(replay.replayed).toBe(true);
    expect(replay.calldataHash).toBe(first.calldataHash);
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "create-job",
        sessionWallet: CLIENT,
        idempotencyKey: "changed-key-001",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("fails closed on deployment identity drift", async () => {
    const state = await fixture();
    state.chain.deploymentError = new Error("PROXY_CODE_HASH_MISMATCH");
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "create-job",
        sessionWallet: CLIENT,
        idempotencyKey: "deploy-key-0001",
      }),
    ).rejects.toThrow("PROXY_CODE_HASH_MISMATCH");
  });

  it("rejects a wrong runtime chain before preparing calldata", async () => {
    const state = await fixture();
    state.chain.context = { ...CONTEXT, chainId: 5_042n };
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "create-job",
        sessionWallet: CLIENT,
        idempotencyKey: "wrong-chain-0001",
      }),
    ).rejects.toMatchObject({ code: "WRONG_CHAIN" });
  });

  it("invalidates a live preparation after a prepared-block reorg", async () => {
    const state = await fixture();
    await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "reorg-key-00001",
    );
    state.chain.preparedBlockHash = `0x${"99".repeat(32)}`;
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "create-job",
        sessionWallet: CLIENT,
        idempotencyKey: "reorg-key-00001",
      }),
    ).rejects.toMatchObject({ code: "PREPARATION_BLOCK_REORGED" });
  });

  it("refreshes an expired preparation with new chain-derived deadlines", async () => {
    const state = await fixture();
    const first = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "stale-key-00001",
    );
    const stored = await state.repository.getWalletAction(
      state.draft.id,
      "CREATE_JOB",
    );
    if (stored === undefined) throw new Error("missing preparation");
    stored.preparationExpiresAt.setTime(Date.now() - 1);
    state.chain.context = {
      ...CONTEXT,
      blockNumber: CONTEXT.blockNumber + 5n,
      timestamp: CONTEXT.timestamp + 600n,
      blockHash: `0x${"45".repeat(32)}`,
    };
    const refreshed = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "stale-key-00001",
    );
    expect(refreshed.replayed).toBe(false);
    expect(refreshed.calldataHash).not.toBe(first.calldataHash);
    expect(refreshed.deadlines?.completionDeadline).toBe(
      (CONTEXT.timestamp + 600n + 7_200n).toString(),
    );
  });

  it.each([
    ["wrong status", { status: 1 }],
    ["wrong client", { client: OTHER }],
    ["wrong provider", { provider: OTHER }],
    ["wrong evaluator", { evaluator: OTHER }],
    ["wrong expiry", { expiredAt: CONTEXT.timestamp + 21_601n }],
    ["premature budget", { budget: 1n }],
    ["wrong payment token", { paymentToken: getAddress(TESTNET_USDC_ADDRESS) }],
    ["wrong hook", { hook: OTHER }],
    ["wrong provider agent", { providerAgentId: 1n }],
    ["wrong description", { description: "tampered" }],
  ] as const)("rejects a created job with %s", async (_name, override) => {
    const state = await fixture();
    const plan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      `created-job-${_name.replaceAll(" ", "-")}`,
    );
    const hash = txHash(24);
    state.chain.evidence.set(hash, evidence(hash, plan));
    state.chain.job = openJob({
      expiredAt: BigInt(plan.deadlines?.expiredAt ?? "0"),
      ...override,
    });
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        hash,
      ),
    ).rejects.toMatchObject({ code: "CREATED_JOB_CANONICAL_MISMATCH" });
  });

  it.each([
    ["missing", { exists: false }],
    ["condition", { conditionHash: `0x${"77".repeat(32)}` as Hex32 }],
    ["deadline", { completionDeadline: CONTEXT.timestamp + 7_201n }],
    ["verifier", { verifier: OTHER }],
    ["accepted", { accepted: true }],
  ] as const)(
    "rejects %s binding drift during confirmation",
    async (_name, override) => {
      const state = await fixture();
      const createPlan = await confirmCreate(state);
      const bindPlan = await prepare(
        state.runtime,
        state.draft.publicSlug,
        "bind-condition",
        CLIENT,
        `binding-${_name}-0001`,
      );
      state.chain.binding = {
        exists: true,
        conditionHash: state.draft.conditionHash,
        completionDeadline: BigInt(
          createPlan.deadlines?.completionDeadline ?? "0",
        ),
        verifier: getAddress(TESTNET_VERIFIER_ADDRESS),
        accepted: false,
        ...override,
      };
      const hash = txHash(25);
      state.chain.evidence.set(hash, evidence(hash, bindPlan));
      await expect(
        confirm(
          state.runtime,
          state.draft.publicSlug,
          "bind-condition",
          CLIENT,
          hash,
        ),
      ).rejects.toMatchObject({ code: "CANONICAL_BINDING_MISMATCH" });
    },
  );

  it("treats temporary RPC skew as retryable without a durable transition", async () => {
    const state = await fixture();
    await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "rpc-skew-key-01",
    );
    const hash = txHash(26);
    state.chain.evidence.set(hash, new Error("RPC_TIMEOUT"));
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        hash,
      ),
    ).rejects.toMatchObject({ code: "CHAIN_READ_RETRYABLE", status: 503 });
    expect(
      (await state.repository.getWalletAction(state.draft.id, "CREATE_JOB"))
        ?.confirmationStatus,
    ).toBe("PENDING");
  });

  it("rejects a matching transaction mined before its preparation block", async () => {
    const state = await fixture();
    const plan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "predates-key-001",
    );
    const hash = txHash(27);
    state.chain.evidence.set(
      hash,
      evidence(hash, plan, { blockNumber: CONTEXT.blockNumber - 1n }),
    );
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        hash,
      ),
    ).rejects.toMatchObject({ code: "TRANSACTION_PREDATES_PREPARATION" });
  });

  it.each([
    ["wrong chain", { chainId: 5_042n }, "WRONG_CHAIN_RECEIPT"],
    ["wrong sender", { from: OTHER }, "TRANSACTION_SENDER_MISMATCH"],
    ["wrong target", { to: OTHER }, "TRANSACTION_TARGET_MISMATCH"],
    ["wrong value", { value: 1n }, "TRANSACTION_VALUE_MISMATCH"],
    [
      "wrong calldata",
      { input: "0x1234" as Hex },
      "TRANSACTION_CALLDATA_MISMATCH",
    ],
    [
      "reverted",
      { receiptStatus: "reverted" as const },
      "TRANSACTION_REVERTED",
    ],
  ] as const)("rejects confirmation with %s", async (_name, override, code) => {
    const state = await fixture();
    const plan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      `matrix-${code}`.slice(0, 64),
    );
    const hash = txHash(20);
    state.chain.evidence.set(hash, evidence(hash, plan, override));
    state.chain.job = openJob({
      expiredAt: BigInt(plan.deadlines?.expiredAt ?? "0"),
    });
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        hash,
      ),
    ).rejects.toMatchObject({ code });
  });

  it.each([["TRANSACTION_NOT_FOUND"], ["TRANSACTION_PENDING"]] as const)(
    "keeps %s retryable and unconfirmed",
    async (message) => {
      const state = await fixture();
      await prepare(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        `retry-${message}`.slice(0, 64),
      );
      const hash = txHash(21);
      state.chain.evidence.set(hash, new Error(message));
      await expect(
        confirm(
          state.runtime,
          state.draft.publicSlug,
          "create-job",
          CLIENT,
          hash,
        ),
      ).rejects.toMatchObject({ code: message });
      expect(
        (await state.repository.getWalletAction(state.draft.id, "CREATE_JOB"))
          ?.confirmationStatus,
      ).toBe("PENDING");
    },
  );

  it("rejects missing canonical JobCreated evidence and a tampered created job", async () => {
    const state = await fixture();
    const plan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "event-key-00001",
    );
    const hash = txHash(22);
    state.chain.evidence.set(hash, evidence(hash, plan));
    state.chain.createdEventValid = false;
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        hash,
      ),
    ).rejects.toThrow("CANONICAL_JOB_CREATED_EVENT_MISSING");
    state.chain.createdEventValid = true;
    state.chain.job = openJob({
      expiredAt: BigInt(plan.deadlines?.expiredAt ?? "0"),
      provider: OTHER,
    });
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "create-job",
        CLIENT,
        hash,
      ),
    ).rejects.toMatchObject({ code: "CREATED_JOB_CANONICAL_MISMATCH" });
  });

  it("derives the job ID exclusively from canonical JobCreated evidence", async () => {
    const state = await fixture();
    state.chain.createdJobId = 92n;
    const plan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "derived-job-key-01",
    );
    state.chain.job = openJob({
      expiredAt: BigInt(plan.deadlines?.expiredAt ?? "0"),
    });
    const hash = txHash(28);
    state.chain.evidence.set(hash, evidence(hash, plan));
    const result = await confirm(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      hash,
    );
    expect(result.jobId).toBe("92");
  });

  it("marks an exact allowance already satisfied without a transaction", async () => {
    const state = await fixture();
    await confirmCreate(state);
    await confirmBind(state);
    await confirmBudget(state);
    state.chain.allowance = 1_000n;
    const result = await prepareWalletAction({
      runtime: state.runtime,
      slug: state.draft.publicSlug,
      actionPath: "approve-usdc",
      sessionWallet: CLIENT,
      idempotencyKey: "allowance-key-01",
    });
    expect(result).toMatchObject({
      result: "ALREADY_SATISFIED",
      exactAllowance: "1000",
    });
    const stored = await state.repository.getWalletAction(
      state.draft.id,
      "APPROVE_USDC",
    );
    expect(stored?.confirmationStatus).toBe("CONFIRMED");
    expect(stored?.transactionHash).toBeNull();
  });

  it("prepares an exact finite correction for excess allowance", async () => {
    const state = await fixture();
    await confirmCreate(state);
    await confirmBind(state);
    await confirmBudget(state);
    state.chain.allowance = (1n << 256n) - 1n;
    const result = await prepareWalletAction({
      runtime: state.runtime,
      slug: state.draft.publicSlug,
      actionPath: "approve-usdc",
      sessionWallet: CLIENT,
      idempotencyKey: "excess-key-0001",
    });
    expect(result).toMatchObject({
      result: "PREPARED",
      allowancePolicy: "REDUCE_EXCESS_TO_EXACT",
      to: getAddress(TESTNET_USDC_ADDRESS),
    });
  });

  it("rejects binding drift, budget drift, allowance drift, and expired submit", async () => {
    const bindState = await fixture();
    await confirmCreate(bindState);
    bindState.chain.binding = {
      exists: true,
      conditionHash: `0x${"99".repeat(32)}`,
      completionDeadline: CONTEXT.timestamp + 7_200n,
      verifier: getAddress(TESTNET_VERIFIER_ADDRESS),
      accepted: false,
    };
    const fakeBind = await bindState.repository.savePreparedAction({
      draftId: bindState.draft.id,
      pactRecordId: bindState.draft.id,
      action: "BIND_CONDITION",
      requiredSigner: CLIENT,
      chainId: TESTNET_CHAIN_ID,
      expectedTarget: getAddress(TESTNET_EVALUATOR_ADDRESS),
      value: 0n,
      calldataHash: `0x${"88".repeat(32)}`,
      semanticHash: `0x${"77".repeat(32)}`,
      preparationVersion: 1,
      preparedAtBlock: CONTEXT.blockNumber,
      preparedAtBlockHash: BLOCK_HASH,
      preparationExpiresAt: new Date(Date.now() + 300_000),
      expectedStateTransition: "OPEN_JOB_TO_CONDITION_BOUND",
      completionDeadline: CONTEXT.timestamp + 7_200n,
      jobExpiredAt: CONTEXT.timestamp + 21_600n,
      idempotencyKey: "drift-key-00001",
    });
    expect(fakeBind.kind).toBe("CREATED");
    await expect(
      prepareWalletAction({
        runtime: bindState.runtime,
        slug: bindState.draft.publicSlug,
        actionPath: "set-budget",
        sessionWallet: PROVIDER,
        idempotencyKey: "budget-drift-01",
      }),
    ).rejects.toMatchObject({ code: "ACTION_ORDER_REQUIRES_BIND_CONDITION" });

    const state = await fixture();
    await confirmCreate(state);
    await confirmBind(state);
    state.chain.job = { ...state.chain.job, budget: 2_000n };
    await expect(
      prepareWalletAction({
        runtime: state.runtime,
        slug: state.draft.publicSlug,
        actionPath: "set-budget",
        sessionWallet: PROVIDER,
        idempotencyKey: "budget-drift-02",
      }),
    ).rejects.toMatchObject({ code: "CONFLICTING_JOB_BUDGET" });

    state.chain.job = {
      ...state.chain.job,
      budget: 1_000n,
      paymentToken: getAddress(TESTNET_USDC_ADDRESS),
    };
    await confirmBudget(state);
    state.chain.allowance = 999n;
    const approvePlan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "approve-usdc",
      CLIENT,
      "drift-approve-01",
    );
    const approveHash = txHash(23);
    state.chain.evidence.set(approveHash, evidence(approveHash, approvePlan));
    await expect(
      confirm(
        state.runtime,
        state.draft.publicSlug,
        "approve-usdc",
        CLIENT,
        approveHash,
      ),
    ).rejects.toMatchObject({ code: "EXACT_ALLOWANCE_REQUIRED" });
  });

  it.each([
    ["completion", 7_200n, "COMPLETION_DEADLINE_EXPIRED"],
    ["expiry", 21_600n, "COMPLETION_DEADLINE_EXPIRED"],
  ] as const)(
    "rejects submit at the %s deadline",
    async (_name, offset, code) => {
      const state = await fixture();
      await confirmCreate(state);
      await confirmBind(state);
      await confirmBudget(state);
      await confirmApproval(state);
      await confirmFund(state);
      state.chain.context = {
        ...CONTEXT,
        timestamp: CONTEXT.timestamp + offset,
        blockNumber: CONTEXT.blockNumber + 20n,
        blockHash: `0x${"46".repeat(32)}`,
      };
      await expect(
        prepareWalletAction({
          runtime: state.runtime,
          slug: state.draft.publicSlug,
          actionPath: "submit",
          sessionWallet: PROVIDER,
          idempotencyKey: `expired-${_name}-01`,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("does not expose private or signed transaction material in a plan", async () => {
    const state = await fixture();
    const plan = await prepare(
      state.runtime,
      state.draft.publicSlug,
      "create-job",
      CLIENT,
      "surface-key-0001",
    );
    const json = JSON.stringify(plan);
    expect(json).not.toContain("privateKey");
    expect(json).not.toContain("signature");
    expect(json).not.toContain("serializedTransaction");
    expect(Object.keys(plan).sort()).not.toContain("serverSigner");
  });

  it("rejects a transaction hash already claimed by another wallet action", async () => {
    const state = await fixture();
    const base = {
      draftId: state.draft.id,
      pactRecordId: null,
      requiredSigner: CLIENT,
      chainId: TESTNET_CHAIN_ID,
      expectedTarget: getAddress(TESTNET_COMMERCE_ADDRESS),
      value: 0n,
      calldataHash: `0x${"aa".repeat(32)}` as Hex32,
      semanticHash: `0x${"bb".repeat(32)}` as Hex32,
      preparationVersion: 1,
      preparedAtBlock: CONTEXT.blockNumber,
      preparedAtBlockHash: BLOCK_HASH,
      preparationExpiresAt: new Date(Date.now() + 300_000),
      expectedStateTransition: "TEST",
      completionDeadline: null,
      jobExpiredAt: null,
    };
    const first = await state.repository.savePreparedAction({
      ...base,
      action: "CREATE_JOB",
      idempotencyKey: "claim-key-00001",
    });
    const second = await state.repository.savePreparedAction({
      ...base,
      action: "BIND_CONDITION",
      idempotencyKey: "claim-key-00002",
    });
    const hash = txHash(29);
    await state.repository.confirmWalletAction({
      actionId: first.action.id,
      transactionHash: hash,
      confirmedJobId: JOB_ID,
      confirmedJobKey: `0x${"cc".repeat(32)}`,
      confirmedJobStatus: 0,
      confirmedAtBlock: CONTEXT.blockNumber,
      confirmedAtBlockHash: BLOCK_HASH,
      confirmedAt: new Date(),
    });
    await expect(
      state.repository.confirmWalletAction({
        actionId: second.action.id,
        transactionHash: hash,
        confirmedJobId: JOB_ID,
        confirmedJobKey: `0x${"cc".repeat(32)}`,
        confirmedJobStatus: 0,
        confirmedAtBlock: CONTEXT.blockNumber,
        confirmedAtBlockHash: BLOCK_HASH,
        confirmedAt: new Date(),
      }),
    ).rejects.toThrow("TRANSACTION_ALREADY_CLAIMED");
  });

  it("collapses concurrent confirmation into one durable transition", async () => {
    const state = await fixture();
    const saved = await state.repository.savePreparedAction({
      draftId: state.draft.id,
      pactRecordId: null,
      action: "CREATE_JOB",
      requiredSigner: CLIENT,
      chainId: TESTNET_CHAIN_ID,
      expectedTarget: getAddress(TESTNET_COMMERCE_ADDRESS),
      value: 0n,
      calldataHash: `0x${"dd".repeat(32)}`,
      semanticHash: `0x${"ee".repeat(32)}`,
      preparationVersion: 1,
      preparedAtBlock: CONTEXT.blockNumber,
      preparedAtBlockHash: BLOCK_HASH,
      preparationExpiresAt: new Date(Date.now() + 300_000),
      expectedStateTransition: "TEST",
      completionDeadline: null,
      jobExpiredAt: null,
      idempotencyKey: "concurrent-key-01",
    });
    const request = {
      actionId: saved.action.id,
      transactionHash: txHash(30),
      confirmedJobId: JOB_ID,
      confirmedJobKey: `0x${"ff".repeat(32)}` as Hex32,
      confirmedJobStatus: 0,
      confirmedAtBlock: CONTEXT.blockNumber,
      confirmedAtBlockHash: BLOCK_HASH,
      confirmedAt: new Date(),
    };
    const results = await Promise.all([
      state.repository.confirmWalletAction(request),
      state.repository.confirmWalletAction(request),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(
      (await state.repository.getWalletAction(state.draft.id, "CREATE_JOB"))
        ?.confirmationStatus,
    ).toBe("CONFIRMED");
  });
});
