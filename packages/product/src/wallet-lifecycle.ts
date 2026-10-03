import {
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import {
  verifyGitHubPrMerged,
  type GitHubPullRequestClient,
} from "@pact/verifier/github";
import {
  encodeFunctionData,
  getAddress,
  isHash,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import type { CanonicalPactRegistrar } from "./canonical-link";
import {
  PRODUCT_CHAIN_ID,
  PRODUCT_COMPLETION_OFFSET_SECONDS,
  PRODUCT_EXPIRY_OFFSET_SECONDS,
  PRODUCT_PREPARATION_TTL_SECONDS,
  PRODUCT_PREPARATION_VERSION,
} from "./constants";
import { authorizeDraftClient, authorizeDraftProvider } from "./config";
import { ProductError, validateIdempotencyKey } from "./service";
import type {
  PactDraft,
  ProductRepository,
  WalletAction,
  WalletActionKind,
} from "./types";
import {
  productErc8183Abi,
  productEvaluatorAbi,
  productUsdcAbi,
  ZERO_ADDRESS,
} from "./wallet-abi";
import type {
  ProductBlockContext,
  ProductChainClient,
  ProductGasDiagnostics,
  ProductJob,
} from "./wallet-chain";

export const walletActionPaths = [
  "create-job",
  "bind-condition",
  "set-budget",
  "approve-usdc",
  "fund",
  "submit",
] as const;
export type WalletActionPath = (typeof walletActionPaths)[number];

const pathToKind: Readonly<Record<WalletActionPath, WalletActionKind>> = {
  "create-job": "CREATE_JOB",
  "bind-condition": "BIND_CONDITION",
  "set-budget": "SET_BUDGET",
  "approve-usdc": "APPROVE_USDC",
  fund: "FUND",
  submit: "SUBMIT",
};
const orderedKinds = [
  "CREATE_JOB",
  "BIND_CONDITION",
  "SET_BUDGET",
  "APPROVE_USDC",
  "FUND",
  "SUBMIT",
] as const;

const expectedTransitions: Readonly<Record<WalletActionKind, string>> = {
  CREATE_JOB: "DRAFT_TO_OPEN_JOB",
  BIND_CONDITION: "OPEN_JOB_TO_CONDITION_BOUND",
  SET_BUDGET: "OPEN_JOB_TO_BUDGET_SET",
  APPROVE_USDC: "ALLOWANCE_TO_EXACT_BUDGET",
  FUND: "OPEN_TO_FUNDED",
  SUBMIT: "FUNDED_TO_SUBMITTED",
};

export interface PreparedTransactionPlan {
  readonly result: "PREPARED";
  readonly replayed: boolean;
  readonly action: WalletActionKind;
  readonly chainId: number;
  readonly requiredSigner: Address;
  readonly to: Address;
  readonly value: string;
  readonly data: Hex;
  readonly calldataHash: Hex32;
  readonly preparationVersion: number;
  readonly preparedAtBlock: string;
  readonly preparedAtBlockHash: Hex32;
  readonly preparationExpiresAt: string;
  readonly expectedStateTransition: string;
  readonly summary: string;
  readonly estimatedGas: string | null;
  readonly fee: {
    readonly gasPrice: string;
    readonly nativeBalance: string;
    readonly erc20BalanceBaseUnits: string;
    readonly requiredNativeBalance: string | null;
    readonly readiness: ProductGasDiagnostics["readiness"];
    readonly sharedUnderlyingBalance: true;
  };
  readonly deadlines: {
    readonly completionDeadline: string;
    readonly expiredAt: string;
  } | null;
  readonly allowancePolicy?: "EXACT_FINITE" | "REDUCE_EXCESS_TO_EXACT";
}

export interface AlreadySatisfiedResult {
  readonly result: "ALREADY_SATISFIED";
  readonly action: "APPROVE_USDC";
  readonly chainId: number;
  readonly requiredSigner: Address;
  readonly exactAllowance: string;
  readonly preparedAtBlock: string;
  readonly preparedAtBlockHash: Hex32;
  readonly expectedStateTransition: string;
  readonly summary: string;
}

export type PrepareWalletActionResult =
  PreparedTransactionPlan | AlreadySatisfiedResult;

export interface ConfirmWalletActionResult {
  readonly replayed: boolean;
  readonly action: WalletActionKind;
  readonly transactionHash: Hex32 | null;
  readonly confirmationStatus: "CONFIRMED";
  readonly confirmedAtBlock: string;
  readonly jobId: string;
  readonly jobKey: Hex32;
  readonly canonicalJobStatus: number;
  readonly productStatus:
    "ACTION_REQUIRED" | "AWAITING_PROVIDER" | "AWAITING_CONDITION";
}

export interface WalletLifecycleRuntime {
  readonly repository: ProductRepository;
  readonly github: GitHubPullRequestClient;
  readonly chain: ProductChainClient;
  readonly registrar: CanonicalPactRegistrar;
}

interface BuiltCall {
  readonly signer: Address;
  readonly target: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly completionDeadline: bigint | null;
  readonly expiredAt: bigint | null;
  readonly jobId: bigint | null;
  readonly summary: string;
  readonly applicationAmountBaseUnits?: bigint;
  readonly allowancePolicy?: PreparedTransactionPlan["allowancePolicy"];
}

function equalAddress(left: string, right: string): boolean {
  return getAddress(left) === getAddress(right);
}

function assertDraftIntegrity(draft: PactDraft): void {
  if (
    draft.chainId !== PRODUCT_CHAIN_ID ||
    draft.network !== "arc-testnet" ||
    draft.event !== "PR_MERGED" ||
    draft.amountBaseUnits <= 0n ||
    draft.completionOffsetSeconds !== PRODUCT_COMPLETION_OFFSET_SECONDS ||
    draft.expiryOffsetSeconds !== PRODUCT_EXPIRY_OFFSET_SECONDS ||
    draft.condition.repository !== draft.githubRepository ||
    draft.condition.pullRequest !== draft.githubPullRequest ||
    draft.condition.baseBranch !== draft.baseBranch ||
    draft.condition.event !== draft.event ||
    hashGithubPrMergedCondition(draft.condition) !== draft.conditionHash
  ) {
    throw new ProductError("DRAFT_INTEGRITY_MISMATCH", 409);
  }
}

function confirmed(action: WalletAction | undefined): boolean {
  return action?.confirmationStatus === "CONFIRMED";
}

function semanticHash(input: {
  readonly draft: PactDraft;
  readonly action: WalletActionKind;
  readonly signer: Address;
  readonly target: Address;
  readonly jobId: bigint | null;
}): Hex32 {
  return keccak256(
    stringToHex(
      JSON.stringify({
        draftHash: input.draft.canonicalRequestHash,
        conditionHash: input.draft.conditionHash,
        action: input.action,
        signer: input.signer,
        target: input.target,
        jobId: input.jobId?.toString() ?? null,
        amountBaseUnits: input.draft.amountBaseUnits.toString(),
        chainId: input.draft.chainId.toString(),
        preparationVersion: PRODUCT_PREPARATION_VERSION,
      }),
    ),
  ) as Hex32;
}

function actionKind(path: string): WalletActionKind {
  if (!walletActionPaths.includes(path as WalletActionPath))
    throw new ProductError("UNSUPPORTED_ACTION", 404);
  return pathToKind[path as WalletActionPath];
}

function signerFor(draft: PactDraft, action: WalletActionKind): Address {
  return action === "SET_BUDGET" || action === "SUBMIT"
    ? draft.providerAddress
    : draft.creatingWallet;
}

function requireAuthorizedSigner(
  draft: PactDraft,
  action: WalletActionKind,
  sessionWallet: string,
): Address {
  const authorized =
    action === "SET_BUDGET" || action === "SUBMIT"
      ? authorizeDraftProvider(sessionWallet, draft.providerAddress)
      : authorizeDraftClient(sessionWallet, draft.creatingWallet);
  if (!authorized) {
    throw new ProductError(
      action === "SET_BUDGET" || action === "SUBMIT"
        ? "WRONG_PROVIDER_WALLET"
        : "WRONG_CLIENT_WALLET",
      403,
    );
  }
  return signerFor(draft, action);
}

async function loadActionState(
  repository: ProductRepository,
  draft: PactDraft,
): Promise<ReadonlyMap<WalletActionKind, WalletAction>> {
  const pairs = await Promise.all(
    orderedKinds.map(
      async (kind) =>
        [kind, await repository.getWalletAction(draft.id, kind)] as const,
    ),
  );
  return new Map(
    pairs.filter(
      (pair): pair is readonly [WalletActionKind, WalletAction] =>
        pair[1] !== undefined,
    ),
  );
}

function requireOrder(
  action: WalletActionKind,
  actions: ReadonlyMap<WalletActionKind, WalletAction>,
): void {
  const index = orderedKinds.indexOf(action);
  for (const prerequisite of orderedKinds.slice(0, index)) {
    if (!confirmed(actions.get(prerequisite)))
      throw new ProductError(`ACTION_ORDER_REQUIRES_${prerequisite}`, 409);
  }
  if (confirmed(actions.get(action)))
    throw new ProductError("ACTION_ALREADY_CONFIRMED", 409);
}

function createDescription(draft: PactDraft): string {
  return `Pact PR_MERGED ${draft.githubRepository}#${draft.githubPullRequest}`;
}

function requireLinkedJob(
  draft: PactDraft,
  actions: ReadonlyMap<WalletActionKind, WalletAction>,
): { readonly jobId: bigint; readonly createAction: WalletAction } {
  const createAction = actions.get("CREATE_JOB");
  if (
    draft.linkedPactRecordId === null ||
    createAction?.confirmedJobId === null ||
    createAction === undefined
  ) {
    throw new ProductError("CANONICAL_JOB_NOT_LINKED", 409);
  }
  return { jobId: createAction.confirmedJobId, createAction };
}

function requireOpenJob(
  draft: PactDraft,
  job: ProductJob,
  chain: ProductChainClient,
): void {
  if (
    job.status !== 0 ||
    !equalAddress(job.client, draft.creatingWallet) ||
    !equalAddress(job.provider, draft.providerAddress) ||
    !equalAddress(job.evaluator, chain.deployment.evaluator)
  ) {
    throw new ProductError("CANONICAL_JOB_STATE_MISMATCH", 409);
  }
}

async function assertBinding(
  runtime: WalletLifecycleRuntime,
  draft: PactDraft,
  jobId: bigint,
  completionDeadline: bigint,
  blockNumber?: bigint,
): Promise<void> {
  const binding = await runtime.chain.readBinding(jobId, blockNumber);
  if (
    !binding.exists ||
    binding.conditionHash !== draft.conditionHash ||
    binding.completionDeadline !== completionDeadline ||
    !equalAddress(binding.verifier, runtime.chain.deployment.verifier) ||
    binding.accepted
  ) {
    throw new ProductError("CANONICAL_BINDING_MISMATCH", 409);
  }
}

async function assertGitHubStillOpen(
  github: GitHubPullRequestClient,
  draft: PactDraft,
  chainTimestamp: bigint,
): Promise<void> {
  const verification = await verifyGitHubPrMerged({
    condition: draft.condition,
    completionDeadline:
      chainTimestamp + BigInt(PRODUCT_COMPLETION_OFFSET_SECONDS),
    observedAt: chainTimestamp,
    client: github,
  });
  if (
    verification.status !== "NOT_SATISFIED" ||
    verification.reason !== "PULL_REQUEST_NOT_MERGED" ||
    !verification.retryable
  ) {
    throw new ProductError("PULL_REQUEST_NOT_OPEN_FOR_CREATE", 409);
  }
}

async function buildCall(input: {
  readonly runtime: WalletLifecycleRuntime;
  readonly draft: PactDraft;
  readonly action: WalletActionKind;
  readonly actions: ReadonlyMap<WalletActionKind, WalletAction>;
  readonly context: ProductBlockContext;
}): Promise<BuiltCall | "ALLOWANCE_SATISFIED"> {
  const { runtime, draft, action, actions, context } = input;
  const deployment = runtime.chain.deployment;
  const signer = signerFor(draft, action);
  const existing = actions.get(action);
  if (action === "CREATE_JOB") {
    if (draft.linkedPactRecordId !== null)
      throw new ProductError("CANONICAL_JOB_ALREADY_LINKED", 409);
    await assertGitHubStillOpen(runtime.github, draft, context.timestamp);
    const completionDeadline =
      existing?.confirmationStatus === "PENDING" &&
      existing.preparationExpiresAt > new Date() &&
      existing.completionDeadline !== null
        ? existing.completionDeadline
        : context.timestamp + BigInt(PRODUCT_COMPLETION_OFFSET_SECONDS);
    const expiredAt =
      existing?.confirmationStatus === "PENDING" &&
      existing.preparationExpiresAt > new Date() &&
      existing.jobExpiredAt !== null
        ? existing.jobExpiredAt
        : context.timestamp + BigInt(PRODUCT_EXPIRY_OFFSET_SECONDS);
    return {
      signer,
      target: deployment.commerce,
      value: 0n,
      data: encodeFunctionData({
        abi: productErc8183Abi,
        functionName: "createJob",
        args: [
          draft.providerAddress,
          deployment.evaluator,
          Number(expiredAt),
          createDescription(draft),
          ZERO_ADDRESS,
          0n,
        ],
      }),
      completionDeadline,
      expiredAt,
      jobId: null,
      summary: `Create an Arc Testnet Pact job for ${draft.githubRepository}#${draft.githubPullRequest}.`,
    };
  }

  const { jobId, createAction } = requireLinkedJob(draft, actions);
  if (
    createAction.completionDeadline === null ||
    createAction.jobExpiredAt === null
  ) {
    throw new ProductError("PREPARED_DEADLINES_MISSING", 409);
  }
  const job = await runtime.chain.readJob(jobId, context.blockNumber);
  if (action === "BIND_CONDITION") {
    requireOpenJob(draft, job, runtime.chain);
    const binding = await runtime.chain.readBinding(jobId, context.blockNumber);
    if (binding.exists) throw new ProductError("BINDING_ALREADY_EXISTS", 409);
    return {
      signer,
      target: deployment.evaluator,
      value: 0n,
      data: encodeFunctionData({
        abi: productEvaluatorAbi,
        functionName: "bindCondition",
        args: [
          jobId,
          draft.conditionHash,
          createAction.completionDeadline,
          deployment.verifier,
        ],
      }),
      completionDeadline: createAction.completionDeadline,
      expiredAt: createAction.jobExpiredAt,
      jobId,
      summary: "Bind the immutable GitHub PR_MERGED condition to the Open job.",
    };
  }

  await assertBinding(
    runtime,
    draft,
    jobId,
    createAction.completionDeadline,
    context.blockNumber,
  );
  if (action === "SET_BUDGET") {
    requireOpenJob(draft, job, runtime.chain);
    if (job.budget !== 0n && job.budget !== draft.amountBaseUnits)
      throw new ProductError("CONFLICTING_JOB_BUDGET", 409);
    return {
      signer,
      target: deployment.commerce,
      value: 0n,
      data: encodeFunctionData({
        abi: productErc8183Abi,
        functionName: "setBudget",
        args: [jobId, deployment.usdc, draft.amountBaseUnits, "0x"],
      }),
      completionDeadline: createAction.completionDeadline,
      expiredAt: createAction.jobExpiredAt,
      jobId,
      summary: `Set the immutable job budget to ${draft.amountBaseUnits} USDC base units.`,
    };
  }
  if (action === "APPROVE_USDC") {
    requireOpenJob(draft, job, runtime.chain);
    if (
      job.budget !== draft.amountBaseUnits ||
      !equalAddress(job.paymentToken, deployment.usdc)
    ) {
      throw new ProductError("CANONICAL_BUDGET_MISMATCH", 409);
    }
    const allowance = await runtime.chain.readAllowance(
      draft.creatingWallet,
      context.blockNumber,
    );
    if (allowance === draft.amountBaseUnits) return "ALLOWANCE_SATISFIED";
    return {
      signer,
      target: deployment.usdc,
      value: 0n,
      data: encodeFunctionData({
        abi: productUsdcAbi,
        functionName: "approve",
        args: [deployment.commerce, draft.amountBaseUnits],
      }),
      completionDeadline: createAction.completionDeadline,
      expiredAt: createAction.jobExpiredAt,
      jobId,
      summary:
        allowance > draft.amountBaseUnits
          ? `Replace the excess USDC allowance with the exact finite amount ${draft.amountBaseUnits}.`
          : `Approve the exact finite USDC amount ${draft.amountBaseUnits} for the certified commerce proxy.`,
      allowancePolicy:
        allowance > draft.amountBaseUnits
          ? "REDUCE_EXCESS_TO_EXACT"
          : "EXACT_FINITE",
    };
  }
  if (action === "FUND") {
    requireOpenJob(draft, job, runtime.chain);
    if (
      job.budget !== draft.amountBaseUnits ||
      !equalAddress(job.paymentToken, deployment.usdc)
    ) {
      throw new ProductError("CANONICAL_BUDGET_MISMATCH", 409);
    }
    const allowance = await runtime.chain.readAllowance(
      draft.creatingWallet,
      context.blockNumber,
    );
    if (allowance !== draft.amountBaseUnits)
      throw new ProductError("EXACT_ALLOWANCE_REQUIRED", 409);
    return {
      signer,
      target: deployment.commerce,
      value: 0n,
      data: encodeFunctionData({
        abi: productErc8183Abi,
        functionName: "fund",
        args: [jobId, deployment.usdc, draft.amountBaseUnits, "0x"],
      }),
      completionDeadline: createAction.completionDeadline,
      expiredAt: createAction.jobExpiredAt,
      jobId,
      summary: `Fund the job with exactly ${draft.amountBaseUnits} USDC base units.`,
      applicationAmountBaseUnits: draft.amountBaseUnits,
    };
  }
  if (job.status !== 1) throw new ProductError("JOB_NOT_FUNDED", 409);
  if (context.timestamp >= createAction.completionDeadline)
    throw new ProductError("COMPLETION_DEADLINE_EXPIRED", 409);
  if (context.timestamp >= createAction.jobExpiredAt)
    throw new ProductError("JOB_EXPIRED", 409);
  return {
    signer,
    target: deployment.commerce,
    value: 0n,
    data: encodeFunctionData({
      abi: productErc8183Abi,
      functionName: "submit",
      args: [jobId, draft.conditionHash, "0x"],
    }),
    completionDeadline: createAction.completionDeadline,
    expiredAt: createAction.jobExpiredAt,
    jobId,
    summary:
      "Submit the deterministic Pact condition hash as the certified deliverable.",
  };
}

export async function prepareWalletAction(input: {
  readonly runtime: WalletLifecycleRuntime;
  readonly slug: string;
  readonly actionPath: string;
  readonly sessionWallet: string;
  readonly idempotencyKey: string | null;
}): Promise<PrepareWalletActionResult> {
  const action = actionKind(input.actionPath);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const draft = await input.runtime.repository.getDraftBySlug(input.slug);
  if (draft === undefined) throw new ProductError("PACT_NOT_FOUND", 404);
  assertDraftIntegrity(draft);
  const signer = requireAuthorizedSigner(draft, action, input.sessionWallet);
  const actions = await loadActionState(input.runtime.repository, draft);
  requireOrder(action, actions);
  await input.runtime.chain.verifyDeployment();
  const context = await input.runtime.chain.readContext();
  if (context.chainId !== PRODUCT_CHAIN_ID)
    throw new ProductError("WRONG_CHAIN", 409);
  const existingAction = actions.get(action);
  if (
    existingAction?.confirmationStatus === "PENDING" &&
    existingAction.preparedAtBlockHash !== null &&
    existingAction.preparationExpiresAt > new Date()
  ) {
    const canonicalHash = await input.runtime.chain.readBlockHash(
      existingAction.preparedAtBlock,
    );
    if (canonicalHash !== existingAction.preparedAtBlockHash)
      throw new ProductError("PREPARATION_BLOCK_REORGED", 409);
  }
  const built = await buildCall({
    runtime: input.runtime,
    draft,
    action,
    actions,
    context,
  });
  const target =
    action === "BIND_CONDITION"
      ? input.runtime.chain.deployment.evaluator
      : action === "APPROVE_USDC"
        ? input.runtime.chain.deployment.usdc
        : input.runtime.chain.deployment.commerce;
  const { jobId } =
    action === "CREATE_JOB"
      ? { jobId: null }
      : requireLinkedJob(draft, actions);
  const semantics = semanticHash({ draft, action, signer, target, jobId });
  if (built === "ALLOWANCE_SATISFIED") {
    const createAction = actions.get("CREATE_JOB");
    const saved = await input.runtime.repository.savePreparedAction({
      draftId: draft.id,
      pactRecordId: draft.linkedPactRecordId,
      action,
      requiredSigner: signer,
      chainId: PRODUCT_CHAIN_ID,
      expectedTarget: target,
      value: 0n,
      calldataHash: keccak256(
        encodeFunctionData({
          abi: productUsdcAbi,
          functionName: "approve",
          args: [
            input.runtime.chain.deployment.commerce,
            draft.amountBaseUnits,
          ],
        }),
      ) as Hex32,
      semanticHash: semantics,
      preparationVersion: PRODUCT_PREPARATION_VERSION,
      preparedAtBlock: context.blockNumber,
      preparedAtBlockHash: context.blockHash as Hex32,
      preparationExpiresAt: new Date(
        Date.now() + PRODUCT_PREPARATION_TTL_SECONDS * 1_000,
      ),
      expectedStateTransition: expectedTransitions[action],
      completionDeadline: createAction?.completionDeadline ?? null,
      jobExpiredAt: createAction?.jobExpiredAt ?? null,
      idempotencyKey,
    });
    if (saved.kind === "CONFLICT")
      throw new ProductError("IDEMPOTENCY_CONFLICT", 409);
    if (saved.kind === "ALREADY_CONFIRMED")
      throw new ProductError("ACTION_ALREADY_CONFIRMED", 409);
    await input.runtime.repository.confirmWalletAction({
      actionId: saved.action.id,
      transactionHash: null,
      confirmedJobId: jobId,
      confirmedJobKey:
        saved.action.pactRecordId === null
          ? null
          : (actions.get("CREATE_JOB")?.confirmedJobKey ?? null),
      confirmedJobStatus: 0,
      confirmedAtBlock: context.blockNumber,
      confirmedAtBlockHash: context.blockHash as Hex32,
      confirmedAt: new Date(),
    });
    return Object.freeze({
      result: "ALREADY_SATISFIED",
      action: "APPROVE_USDC",
      chainId: Number(PRODUCT_CHAIN_ID),
      requiredSigner: signer,
      exactAllowance: draft.amountBaseUnits.toString(),
      preparedAtBlock: context.blockNumber.toString(),
      preparedAtBlockHash: context.blockHash as Hex32,
      expectedStateTransition: expectedTransitions[action],
      summary:
        "The exact finite allowance is already present; no transaction is needed.",
    });
  }
  const calldataHash = keccak256(built.data) as Hex32;
  const expiresAt = new Date(
    Date.now() + PRODUCT_PREPARATION_TTL_SECONDS * 1_000,
  );
  const saved = await input.runtime.repository.savePreparedAction({
    draftId: draft.id,
    pactRecordId: draft.linkedPactRecordId,
    action,
    requiredSigner: built.signer,
    chainId: PRODUCT_CHAIN_ID,
    expectedTarget: built.target,
    value: built.value,
    calldataHash,
    semanticHash: semantics,
    preparationVersion: PRODUCT_PREPARATION_VERSION,
    preparedAtBlock: context.blockNumber,
    preparedAtBlockHash: context.blockHash as Hex32,
    preparationExpiresAt: expiresAt,
    expectedStateTransition: expectedTransitions[action],
    completionDeadline: built.completionDeadline,
    jobExpiredAt: built.expiredAt,
    idempotencyKey,
  });
  if (saved.kind === "CONFLICT")
    throw new ProductError("IDEMPOTENCY_CONFLICT", 409);
  if (saved.kind === "ALREADY_CONFIRMED")
    throw new ProductError("ACTION_ALREADY_CONFIRMED", 409);
  const diagnostics = await input.runtime.chain.diagnoseGas(
    {
      from: built.signer,
      to: built.target,
      value: built.value,
      data: built.data,
      ...(built.applicationAmountBaseUnits === undefined
        ? {}
        : { applicationAmountBaseUnits: built.applicationAmountBaseUnits }),
    },
    context,
  );
  return Object.freeze({
    result: "PREPARED",
    replayed: saved.kind === "REPLAY",
    action,
    chainId: Number(PRODUCT_CHAIN_ID),
    requiredSigner: built.signer,
    to: built.target,
    value: built.value.toString(),
    data: built.data,
    calldataHash,
    preparationVersion: PRODUCT_PREPARATION_VERSION,
    preparedAtBlock: saved.action.preparedAtBlock.toString(),
    preparedAtBlockHash: saved.action.preparedAtBlockHash as Hex32,
    preparationExpiresAt: saved.action.preparationExpiresAt.toISOString(),
    expectedStateTransition: expectedTransitions[action],
    summary: built.summary,
    estimatedGas: diagnostics.estimatedGas?.toString() ?? null,
    fee: {
      gasPrice: diagnostics.gasPrice.toString(),
      nativeBalance: diagnostics.nativeBalance.toString(),
      erc20BalanceBaseUnits: diagnostics.erc20BalanceBaseUnits.toString(),
      requiredNativeBalance:
        diagnostics.requiredNativeBalance?.toString() ?? null,
      readiness: diagnostics.readiness,
      sharedUnderlyingBalance: true as const,
    },
    deadlines:
      built.completionDeadline === null || built.expiredAt === null
        ? null
        : {
            completionDeadline: built.completionDeadline.toString(),
            expiredAt: built.expiredAt.toString(),
          },
    ...(built.allowancePolicy === undefined
      ? {}
      : { allowancePolicy: built.allowancePolicy }),
  });
}

function requireExactTransaction(
  action: WalletAction,
  evidence: Awaited<ReturnType<ProductChainClient["readTransactionEvidence"]>>,
): void {
  if (evidence.chainId !== action.chainId)
    throw new ProductError("WRONG_CHAIN_RECEIPT", 409);
  if (evidence.receiptStatus !== "success")
    throw new ProductError("TRANSACTION_REVERTED", 409);
  if (!equalAddress(evidence.from, action.requiredSigner))
    throw new ProductError("TRANSACTION_SENDER_MISMATCH", 409);
  if (
    evidence.to === null ||
    !equalAddress(evidence.to, action.expectedTarget)
  ) {
    throw new ProductError("TRANSACTION_TARGET_MISMATCH", 409);
  }
  if (evidence.value !== action.value)
    throw new ProductError("TRANSACTION_VALUE_MISMATCH", 409);
  if (keccak256(evidence.input) !== action.calldataHash)
    throw new ProductError("TRANSACTION_CALLDATA_MISMATCH", 409);
  if (evidence.blockNumber < action.preparedAtBlock)
    throw new ProductError("TRANSACTION_PREDATES_PREPARATION", 409);
}

function productStatus(
  action: WalletActionKind,
): ConfirmWalletActionResult["productStatus"] {
  if (action === "SUBMIT") return "AWAITING_CONDITION";
  if (action === "FUND") return "AWAITING_PROVIDER";
  return "ACTION_REQUIRED";
}

export async function confirmWalletAction(input: {
  readonly runtime: WalletLifecycleRuntime;
  readonly slug: string;
  readonly actionPath: string;
  readonly sessionWallet: string;
  readonly transactionHash: string;
}): Promise<ConfirmWalletActionResult> {
  const actionKindValue = actionKind(input.actionPath);
  if (!isHash(input.transactionHash))
    throw new ProductError("INVALID_TRANSACTION_HASH", 400);
  const transactionHash = input.transactionHash as Hex32;
  const draft = await input.runtime.repository.getDraftBySlug(input.slug);
  if (draft === undefined) throw new ProductError("PACT_NOT_FOUND", 404);
  assertDraftIntegrity(draft);
  requireAuthorizedSigner(draft, actionKindValue, input.sessionWallet);
  const action = await input.runtime.repository.getWalletAction(
    draft.id,
    actionKindValue,
  );
  if (action === undefined) throw new ProductError("ACTION_NOT_PREPARED", 409);
  if (action.confirmationStatus === "CONFIRMED") {
    if (action.transactionHash !== transactionHash)
      throw new ProductError("TRANSACTION_CONFIRMATION_CONFLICT", 409);
    if (
      action.confirmedJobId === null ||
      action.confirmedJobKey === null ||
      action.confirmedAtBlock === null ||
      action.confirmedJobStatus === null
    ) {
      throw new ProductError("CONFIRMATION_METADATA_MISSING", 500);
    }
    return Object.freeze({
      replayed: true,
      action: actionKindValue,
      transactionHash,
      confirmationStatus: "CONFIRMED",
      confirmedAtBlock: action.confirmedAtBlock.toString(),
      jobId: action.confirmedJobId.toString(),
      jobKey: action.confirmedJobKey,
      canonicalJobStatus: action.confirmedJobStatus,
      productStatus: productStatus(actionKindValue),
    });
  }
  await input.runtime.chain.verifyDeployment();
  let evidence;
  try {
    evidence =
      await input.runtime.chain.readTransactionEvidence(transactionHash);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "TRANSACTION_NOT_FOUND" ||
        error.message === "TRANSACTION_PENDING")
    ) {
      throw new ProductError(error.message, 409);
    }
    throw new ProductError("CHAIN_READ_RETRYABLE", 503);
  }
  requireExactTransaction(action, evidence);

  let jobId: bigint;
  let jobKey: Hex32;
  let linkedPactRecordId: string | undefined;
  if (actionKindValue === "CREATE_JOB") {
    jobId = input.runtime.chain.jobIdFromCreatedEvent(evidence);
    if (action.completionDeadline === null || action.jobExpiredAt === null)
      throw new ProductError("PREPARED_DEADLINES_MISSING", 500);
    const job = await input.runtime.chain.readJob(jobId);
    if (
      job.status !== 0 ||
      !equalAddress(job.client, draft.creatingWallet) ||
      !equalAddress(job.provider, draft.providerAddress) ||
      !equalAddress(job.evaluator, input.runtime.chain.deployment.evaluator) ||
      job.expiredAt !== action.jobExpiredAt ||
      job.budget !== 0n ||
      !equalAddress(job.paymentToken, ZERO_ADDRESS) ||
      !equalAddress(job.hook, ZERO_ADDRESS) ||
      job.providerAgentId !== 0n ||
      job.description !== createDescription(draft)
    ) {
      throw new ProductError("CREATED_JOB_CANONICAL_MISMATCH", 409);
    }
    const registration = await input.runtime.registrar.register({
      draft,
      commerce: input.runtime.chain.deployment.commerce,
      evaluator: input.runtime.chain.deployment.evaluator,
      jobId,
      completionDeadline: action.completionDeadline,
    });
    jobKey = registration.jobKey;
    linkedPactRecordId = registration.pactRecordId;
  } else {
    const actions = await loadActionState(input.runtime.repository, draft);
    const linked = requireLinkedJob(draft, actions);
    jobId = linked.jobId;
    jobKey = hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: PRODUCT_CHAIN_ID,
        commerceContract: input.runtime.chain.deployment.commerce,
        jobId,
      }),
    ) as Hex32;
    if (linked.createAction.confirmedJobKey !== jobKey)
      throw new ProductError("CANONICAL_JOB_KEY_MISMATCH", 409);
  }

  const job = await input.runtime.chain.readJob(jobId);
  const createAction =
    actionKindValue === "CREATE_JOB"
      ? action
      : await input.runtime.repository.getWalletAction(draft.id, "CREATE_JOB");
  if (
    createAction?.completionDeadline === null ||
    createAction?.completionDeadline === undefined
  ) {
    throw new ProductError("PREPARED_DEADLINES_MISSING", 500);
  }
  if (actionKindValue === "BIND_CONDITION") {
    requireOpenJob(draft, job, input.runtime.chain);
    await assertBinding(
      input.runtime,
      draft,
      jobId,
      createAction.completionDeadline,
    );
  } else if (actionKindValue === "SET_BUDGET") {
    requireOpenJob(draft, job, input.runtime.chain);
    await assertBinding(
      input.runtime,
      draft,
      jobId,
      createAction.completionDeadline,
    );
    if (
      job.budget !== draft.amountBaseUnits ||
      !equalAddress(job.paymentToken, input.runtime.chain.deployment.usdc)
    ) {
      throw new ProductError("CANONICAL_BUDGET_MISMATCH", 409);
    }
  } else if (actionKindValue === "APPROVE_USDC") {
    const allowance = await input.runtime.chain.readAllowance(
      draft.creatingWallet,
    );
    if (allowance !== draft.amountBaseUnits)
      throw new ProductError("EXACT_ALLOWANCE_REQUIRED", 409);
  } else if (actionKindValue === "FUND") {
    if (
      job.status !== 1 ||
      job.budget !== draft.amountBaseUnits ||
      !equalAddress(job.paymentToken, input.runtime.chain.deployment.usdc)
    ) {
      throw new ProductError("CANONICAL_FUNDED_STATE_MISMATCH", 409);
    }
    await assertBinding(
      input.runtime,
      draft,
      jobId,
      createAction.completionDeadline,
    );
  } else if (actionKindValue === "SUBMIT") {
    if (job.status !== 2)
      throw new ProductError("CANONICAL_SUBMITTED_STATE_MISMATCH", 409);
    await assertBinding(
      input.runtime,
      draft,
      jobId,
      createAction.completionDeadline,
    );
  }

  const confirmed = await input.runtime.repository.confirmWalletAction({
    actionId: action.id,
    transactionHash,
    confirmedJobId: jobId,
    confirmedJobKey: jobKey,
    confirmedJobStatus: job.status,
    confirmedAtBlock: evidence.blockNumber,
    confirmedAtBlockHash: evidence.blockHash as Hex32,
    confirmedAt: new Date(),
    ...(linkedPactRecordId === undefined ? {} : { linkedPactRecordId }),
  });
  return Object.freeze({
    replayed: false,
    action: actionKindValue,
    transactionHash,
    confirmationStatus: "CONFIRMED",
    confirmedAtBlock: evidence.blockNumber.toString(),
    jobId: jobId.toString(),
    jobKey,
    canonicalJobStatus: confirmed.confirmedJobStatus ?? job.status,
    productStatus: productStatus(actionKindValue),
  });
}
