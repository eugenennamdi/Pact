import {
  GITHUB_PROVIDER,
  PR_MERGED_EVENT,
  hashGithubPrMergedCondition,
  normalizeGithubPrMergedCondition,
  type Hex32,
} from "@pact/protocol";
import {
  verifyGitHubPrMerged,
  type GitHubPullRequestClient,
} from "@pact/verifier/github";
import { getAddress, keccak256, stringToHex, type Address } from "viem";
import {
  PRODUCT_BASE_BRANCH,
  PRODUCT_COMPLETION_OFFSET_SECONDS,
  PRODUCT_COMPLETION_POLICY_VERSION,
  PRODUCT_EXPIRY_OFFSET_SECONDS,
  PRODUCT_EXPIRY_POLICY_VERSION,
} from "./constants";
import { loadCertifiedProductDeployment } from "./deployment";
import {
  isProductSelfServiceEnabled,
  type ProductNetworkConfig,
  type ProductNetworkId,
} from "./network";
import { toPublicPactDto, type PublicPactDto } from "./read-model";
import type { CreateDraftResult, PactDraft, ProductRepository } from "./types";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const SLUG_PATTERN = /^pact_[a-f0-9]{32}$/;
const UINT256_MAX = (1n << 256n) - 1n;

export class ProductError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ProductError";
    this.code = code;
    this.status = status;
  }
}

export interface CreateDraftRequest {
  readonly repository: string;
  readonly pullRequest: number;
  readonly provider: string;
  readonly amount: string;
}

export interface CreateDraftResponse {
  readonly replayed: boolean;
  readonly publicSlug: string;
  readonly network: ProductNetworkId;
  readonly chainId: number;
  readonly repository: string;
  readonly pullRequest: number;
  readonly baseBranch: "main";
  readonly event: "PR_MERGED";
  readonly client: Address;
  readonly provider: Address;
  readonly amountBaseUnits: string;
  readonly condition: PactDraft["condition"];
  readonly conditionHash: Hex32;
  readonly deadlinePolicy: {
    readonly completionVersion: number;
    readonly completionOffsetSeconds: number;
    readonly expiryVersion: number;
    readonly expiryOffsetSeconds: number;
  };
  readonly commerceAddress: string;
  readonly evaluatorAddress: string;
  readonly draftStatus: PactDraft["lifecycle"];
  readonly next: { readonly actor: "CLIENT"; readonly action: "CREATE_JOB" };
}

export function parseUsdcAmount(amount: string): bigint {
  if (amount.trim() !== amount || amount.length === 0 || amount.length > 80) {
    throw new ProductError("INVALID_AMOUNT", 400);
  }
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(amount);
  if (match === null) throw new ProductError("INVALID_AMOUNT", 400);
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (whole === undefined) throw new ProductError("INVALID_AMOUNT", 400);
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units <= 0n || units > UINT256_MAX) {
    throw new ProductError("INVALID_AMOUNT", 400);
  }
  return units;
}

export function validateIdempotencyKey(value: string | null): string {
  if (value === null || !IDEMPOTENCY_PATTERN.test(value)) {
    throw new ProductError("INVALID_IDEMPOTENCY_KEY", 400);
  }
  return value;
}

function validatePullRequest(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ProductError("INVALID_PULL_REQUEST", 400);
  }
  return value;
}

function requestHash(input: {
  readonly network: ProductNetworkConfig;
  readonly repository: string;
  readonly pullRequest: number;
  readonly provider: Address;
  readonly amountBaseUnits: bigint;
}): Hex32 {
  return keccak256(
    stringToHex(
      JSON.stringify({
        repository: input.repository,
        pullRequest: input.pullRequest,
        provider: input.provider,
        amountBaseUnits: input.amountBaseUnits.toString(),
        network: input.network.id,
        chainId: input.network.chainId.toString(),
        baseBranch: PRODUCT_BASE_BRANCH,
        event: PR_MERGED_EVENT,
      }),
    ),
  ) as Hex32;
}

function response(
  result: CreateDraftResult,
  network: ProductNetworkConfig,
): CreateDraftResponse {
  if (result.kind === "CONFLICT") {
    throw new ProductError("IDEMPOTENCY_CONFLICT", 409);
  }
  const draft = result.draft;
  const deployment = loadCertifiedProductDeployment(network);
  return Object.freeze({
    replayed: result.kind === "REPLAY",
    publicSlug: draft.publicSlug,
    network: network.id,
    chainId: network.chainIdNumber,
    repository: draft.githubRepository,
    pullRequest: draft.githubPullRequest,
    baseBranch: PRODUCT_BASE_BRANCH,
    event: PR_MERGED_EVENT,
    client: draft.creatingWallet,
    provider: draft.providerAddress,
    amountBaseUnits: draft.amountBaseUnits.toString(),
    condition: draft.condition,
    conditionHash: draft.conditionHash,
    deadlinePolicy: {
      completionVersion: PRODUCT_COMPLETION_POLICY_VERSION,
      completionOffsetSeconds: PRODUCT_COMPLETION_OFFSET_SECONDS,
      expiryVersion: PRODUCT_EXPIRY_POLICY_VERSION,
      expiryOffsetSeconds: PRODUCT_EXPIRY_OFFSET_SECONDS,
    },
    commerceAddress: deployment.commerce,
    evaluatorAddress: deployment.evaluator,
    draftStatus: draft.lifecycle,
    next: { actor: "CLIENT" as const, action: "CREATE_JOB" as const },
  });
}

export async function createDraft(input: {
  readonly repository: ProductRepository;
  readonly github: GitHubPullRequestClient;
  readonly sessionWallet: string;
  readonly idempotencyKey: string | null;
  readonly network: ProductNetworkConfig;
  readonly request: CreateDraftRequest;
  readonly now?: Date;
}): Promise<CreateDraftResponse> {
  if (!isProductSelfServiceEnabled(input.network)) {
    throw new ProductError("MAINNET_PRODUCT_MIGRATION_INCOMPLETE", 503);
  }
  const creatingWallet = getAddress(input.sessionWallet);
  let providerAddress: Address;
  try {
    providerAddress = getAddress(input.request.provider);
  } catch {
    throw new ProductError("INVALID_PROVIDER", 400);
  }
  const pullRequest = validatePullRequest(input.request.pullRequest);
  const amountBaseUnits = parseUsdcAmount(input.request.amount);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  let condition;
  try {
    condition = normalizeGithubPrMergedCondition({
      provider: GITHUB_PROVIDER,
      repository: input.request.repository,
      pullRequest,
      baseBranch: PRODUCT_BASE_BRANCH,
      event: PR_MERGED_EVENT,
    });
  } catch {
    throw new ProductError("INVALID_REPOSITORY", 400);
  }
  const canonicalRequestHash = requestHash({
    network: input.network,
    repository: condition.repository,
    pullRequest,
    provider: providerAddress,
    amountBaseUnits,
  });
  const existing = await input.repository.getDraftByIdempotency(
    creatingWallet,
    idempotencyKey,
  );
  if (existing !== undefined) {
    if (existing.canonicalRequestHash !== canonicalRequestHash) {
      throw new ProductError("IDEMPOTENCY_CONFLICT", 409);
    }
    return response({ kind: "REPLAY", draft: existing }, input.network);
  }

  const now = input.now ?? new Date();
  const observedAt = BigInt(Math.floor(now.getTime() / 1_000));
  const verification = await verifyGitHubPrMerged({
    condition,
    completionDeadline: observedAt + BigInt(PRODUCT_COMPLETION_OFFSET_SECONDS),
    observedAt,
    client: input.github,
  });
  if (
    verification.status !== "NOT_SATISFIED" ||
    verification.reason !== "PULL_REQUEST_NOT_MERGED" ||
    !verification.retryable
  ) {
    if (verification.status === "SATISFIED") {
      throw new ProductError("PULL_REQUEST_ALREADY_MERGED", 409);
    }
    if (
      verification.status === "NOT_SATISFIED" &&
      verification.reason === "BASE_BRANCH_MISMATCH"
    ) {
      throw new ProductError("PULL_REQUEST_BASE_MISMATCH", 409);
    }
    throw new ProductError("PULL_REQUEST_NOT_ELIGIBLE", 422);
  }
  const conditionHash = hashGithubPrMergedCondition(condition) as Hex32;
  return response(
    await input.repository.createDraft({
      network: input.network.id,
      chainId: input.network.chainId,
      creatingWallet,
      providerAddress,
      githubRepository: condition.repository,
      githubPullRequest: condition.pullRequest,
      amountBaseUnits,
      condition,
      conditionHash,
      idempotencyKey,
      canonicalRequestHash,
    }),
    input.network,
  );
}

export async function readPublicPact(input: {
  readonly repository: ProductRepository;
  readonly slug: string;
}): Promise<PublicPactDto> {
  if (!SLUG_PATTERN.test(input.slug))
    throw new ProductError("PACT_NOT_FOUND", 404);
  const projection = await input.repository.getPublicProjection(input.slug);
  if (projection === undefined) throw new ProductError("PACT_NOT_FOUND", 404);
  return toPublicPactDto(projection);
}

export async function readPublicEvidence(input: {
  readonly repository: ProductRepository;
  readonly slug: string;
}): Promise<NonNullable<PublicPactDto["evidence"]>> {
  const pact = await readPublicPact(input);
  if (pact.evidence === null) throw new ProductError("EVIDENCE_NOT_READY", 404);
  return pact.evidence;
}

export async function readPublicSettlement(input: {
  readonly repository: ProductRepository;
  readonly slug: string;
}): Promise<NonNullable<PublicPactDto["settlement"]>> {
  const pact = await readPublicPact(input);
  if (pact.settlement === null)
    throw new ProductError("SETTLEMENT_NOT_READY", 404);
  return pact.settlement;
}
