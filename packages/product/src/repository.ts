import {
  GITHUB_PROVIDER,
  PR_MERGED_EVENT,
  hashGithubPrMergedCondition,
  normalizeGithubPrMergedCondition,
  type Hex32,
} from "@pact/protocol";
import type { PactDatabase } from "@pact/database";
import { getAddress } from "viem";
import {
  PRODUCT_BASE_BRANCH,
  PRODUCT_CHAIN_ID,
  PRODUCT_COMPLETION_OFFSET_SECONDS,
  PRODUCT_COMPLETION_POLICY_VERSION,
  PRODUCT_EVENT,
  PRODUCT_EXPIRY_OFFSET_SECONDS,
  PRODUCT_EXPIRY_POLICY_VERSION,
  PRODUCT_NETWORK,
} from "./constants";
import type {
  AuthNonce,
  CreateDraftInput,
  CreateDraftResult,
  PactDraft,
  ProductProjectionInput,
  ProductRepository,
  PublicSettlementSummary,
  WalletAction,
} from "./types";

interface DraftRow {
  readonly id: string;
  readonly public_slug: string;
  readonly creating_wallet: string;
  readonly provider_address: string;
  readonly github_repository: string;
  readonly github_pull_request: string;
  readonly base_branch: string;
  readonly event: string;
  readonly amount_base_units: string;
  readonly network: string;
  readonly chain_id: string;
  readonly condition_hash: string;
  readonly completion_policy_version: number;
  readonly completion_offset_seconds: number;
  readonly expiry_policy_version: number;
  readonly expiry_offset_seconds: number;
  readonly idempotency_key: string;
  readonly canonical_request_hash: string;
  readonly linked_pact_record_id: string | null;
  readonly lifecycle: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface NonceRow {
  readonly id: string;
  readonly wallet_address: string;
  readonly domain: string;
  readonly uri: string;
  readonly nonce: string;
  readonly chain_id: string;
  readonly issued_at: Date;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
}

interface WalletActionRow {
  readonly id: string;
  readonly draft_id: string;
  readonly pact_record_id: string | null;
  readonly action: WalletAction["action"];
  readonly required_signer: string;
  readonly chain_id: string;
  readonly expected_target: string;
  readonly value: string;
  readonly calldata_hash: string;
  readonly preparation_version: number;
  readonly transaction_hash: string | null;
  readonly confirmation_status: WalletAction["confirmationStatus"];
  readonly idempotency_key: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapDraft(row: DraftRow): PactDraft {
  const condition = normalizeGithubPrMergedCondition({
    provider: GITHUB_PROVIDER,
    repository: row.github_repository,
    pullRequest: Number(row.github_pull_request),
    baseBranch: row.base_branch,
    event: PR_MERGED_EVENT,
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  if (
    row.event !== PRODUCT_EVENT ||
    row.network !== PRODUCT_NETWORK ||
    BigInt(row.chain_id) !== PRODUCT_CHAIN_ID ||
    row.condition_hash !== conditionHash
  ) {
    throw new Error("PRODUCT_DRAFT_INTEGRITY_MISMATCH");
  }
  return Object.freeze({
    id: row.id,
    publicSlug: row.public_slug,
    creatingWallet: getAddress(row.creating_wallet),
    providerAddress: getAddress(row.provider_address),
    githubRepository: condition.repository,
    githubPullRequest: condition.pullRequest,
    baseBranch: condition.baseBranch,
    event: condition.event,
    amountBaseUnits: BigInt(row.amount_base_units),
    network: PRODUCT_NETWORK,
    chainId: PRODUCT_CHAIN_ID,
    condition,
    conditionHash: conditionHash as Hex32,
    completionPolicyVersion: row.completion_policy_version,
    completionOffsetSeconds: row.completion_offset_seconds,
    expiryPolicyVersion: row.expiry_policy_version,
    expiryOffsetSeconds: row.expiry_offset_seconds,
    idempotencyKey: row.idempotency_key,
    canonicalRequestHash: row.canonical_request_hash as Hex32,
    linkedPactRecordId: row.linked_pact_record_id,
    lifecycle: row.lifecycle as PactDraft["lifecycle"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapNonce(row: NonceRow): AuthNonce {
  return Object.freeze({
    id: row.id,
    walletAddress: getAddress(row.wallet_address),
    domain: row.domain,
    uri: row.uri,
    nonce: row.nonce,
    chainId: BigInt(row.chain_id),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  });
}

function mapWalletAction(row: WalletActionRow): WalletAction {
  return Object.freeze({
    id: row.id,
    draftId: row.draft_id,
    pactRecordId: row.pact_record_id,
    action: row.action,
    requiredSigner: getAddress(row.required_signer),
    chainId: BigInt(row.chain_id),
    expectedTarget: getAddress(row.expected_target),
    value: BigInt(row.value),
    calldataHash: row.calldata_hash as Hex32,
    preparationVersion: row.preparation_version,
    transactionHash: row.transaction_hash as Hex32 | null,
    confirmationStatus: row.confirmation_status,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function newSlug(): string {
  return `pact_${crypto.randomUUID().replaceAll("-", "")}`;
}

export class PostgresProductRepository implements ProductRepository {
  readonly #database: PactDatabase;

  constructor(database: PactDatabase) {
    this.#database = database;
  }

  async issueNonce(
    input: Omit<AuthNonce, "id" | "consumedAt">,
  ): Promise<AuthNonce> {
    return this.#database.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${input.walletAddress}:${input.domain}`}))`;
      await transaction`
        UPDATE auth_nonces
        SET consumed_at = ${input.issuedAt}
        WHERE wallet_address = ${input.walletAddress}
          AND domain = ${input.domain}
          AND consumed_at IS NULL
      `;
      const rows = await transaction<NonceRow[]>`
        INSERT INTO auth_nonces (
          id, wallet_address, domain, uri, nonce, chain_id, issued_at, expires_at
        ) VALUES (
          ${crypto.randomUUID()}, ${input.walletAddress}, ${input.domain},
          ${input.uri}, ${input.nonce}, ${input.chainId.toString()},
          ${input.issuedAt}, ${input.expiresAt}
        )
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("AUTH_NONCE_INSERT_FAILED");
      return mapNonce(row);
    });
  }

  async getNonce(nonce: string): Promise<AuthNonce | undefined> {
    const rows = await this.#database.sql<NonceRow[]>`
      SELECT * FROM auth_nonces WHERE nonce = ${nonce} LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapNonce(rows[0]);
  }

  async consumeNonce(id: string, consumedAt: Date): Promise<boolean> {
    const rows = await this.#database.sql<{ readonly id: string }[]>`
      UPDATE auth_nonces
      SET consumed_at = ${consumedAt}
      WHERE id = ${id}
        AND consumed_at IS NULL
        AND expires_at > ${consumedAt}
      RETURNING id
    `;
    return rows.length === 1;
  }

  async createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
    const existing = await this.#database.sql<DraftRow[]>`
      SELECT * FROM pact_drafts
      WHERE creating_wallet = ${input.creatingWallet}
        AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `;
    if (existing[0] !== undefined) {
      const draft = mapDraft(existing[0]);
      return draft.canonicalRequestHash === input.canonicalRequestHash
        ? { kind: "REPLAY", draft }
        : { kind: "CONFLICT" };
    }

    const id = crypto.randomUUID();
    const slug = newSlug();
    const inserted = await this.#database.sql<DraftRow[]>`
      INSERT INTO pact_drafts (
        id, public_slug, creating_wallet, provider_address,
        github_repository, github_pull_request, base_branch, event,
        amount_base_units, network, chain_id, condition_hash,
        completion_policy_version, completion_offset_seconds,
        expiry_policy_version, expiry_offset_seconds, idempotency_key,
        canonical_request_hash, lifecycle
      ) VALUES (
        ${id}, ${slug}, ${input.creatingWallet}, ${input.providerAddress},
        ${input.githubRepository}, ${input.githubPullRequest},
        ${PRODUCT_BASE_BRANCH}, ${PRODUCT_EVENT},
        ${input.amountBaseUnits.toString()}, ${PRODUCT_NETWORK},
        ${PRODUCT_CHAIN_ID.toString()}, ${input.conditionHash},
        ${PRODUCT_COMPLETION_POLICY_VERSION},
        ${PRODUCT_COMPLETION_OFFSET_SECONDS},
        ${PRODUCT_EXPIRY_POLICY_VERSION}, ${PRODUCT_EXPIRY_OFFSET_SECONDS},
        ${input.idempotencyKey}, ${input.canonicalRequestHash},
        ${"ACTION_REQUIRED"}
      )
      ON CONFLICT (creating_wallet, idempotency_key) DO NOTHING
      RETURNING *
    `;
    if (inserted[0] !== undefined) {
      return { kind: "CREATED", draft: mapDraft(inserted[0]) };
    }
    const raced = await this.#database.sql<DraftRow[]>`
      SELECT * FROM pact_drafts
      WHERE creating_wallet = ${input.creatingWallet}
        AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `;
    const row = raced[0];
    if (row === undefined) throw new Error("PRODUCT_DRAFT_INSERT_FAILED");
    const draft = mapDraft(row);
    return draft.canonicalRequestHash === input.canonicalRequestHash
      ? { kind: "REPLAY", draft }
      : { kind: "CONFLICT" };
  }

  async getDraftByIdempotency(
    walletAddress: `0x${string}`,
    idempotencyKey: string,
  ): Promise<PactDraft | undefined> {
    const rows = await this.#database.sql<DraftRow[]>`
      SELECT * FROM pact_drafts
      WHERE creating_wallet = ${walletAddress}
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapDraft(rows[0]);
  }

  async getDraftBySlug(slug: string): Promise<PactDraft | undefined> {
    const rows = await this.#database.sql<DraftRow[]>`
      SELECT * FROM pact_drafts WHERE public_slug = ${slug} LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapDraft(rows[0]);
  }

  async getPublicProjection(
    slug: string,
  ): Promise<ProductProjectionInput | undefined> {
    const draft = await this.getDraftBySlug(slug);
    if (draft === undefined) return undefined;
    const actionRows = await this.#database.sql<WalletActionRow[]>`
      SELECT * FROM wallet_actions
      WHERE draft_id = ${draft.id}
      ORDER BY created_at ASC, id ASC
    `;
    const walletActions = actionRows.map(mapWalletAction);
    if (draft.linkedPactRecordId === null) {
      return {
        draft,
        walletActions,
        operationState: null,
        relayState: null,
        chainJobStatus: null,
        chainExpiredAt: null,
        now: BigInt(Math.floor(Date.now() / 1000)),
        jobId: null,
        jobKey: null,
        completionDeadline: null,
        evidence: null,
        settlement: null,
      };
    }
    const rows = await this.#database.sql<
      {
        readonly job_id: string;
        readonly job_key: Hex32;
        readonly completion_deadline: string;
        readonly operation_state: string | null;
        readonly relay_state: string | null;
        readonly chain_job_status: number | null;
        readonly chain_expired_at: string | null;
        readonly evidence_hash: Hex32 | null;
        readonly merge_commit_sha: string | null;
        readonly merged_at: string | null;
        readonly observed_at: string | null;
        readonly canonical_tx_hash: Hex32 | null;
        readonly settlement_block_number: string | null;
      }[]
    >`
      SELECT pr.job_id, pr.job_key, pr.completion_deadline,
        op.state AS operation_state,
        relay.state AS relay_state,
        chain.job_status AS chain_job_status,
        chain.job_expired_at AS chain_expired_at,
        evidence.evidence_hash, evidence.merge_commit_sha,
        evidence.merged_at, evidence.observed_at,
        relay.canonical_tx_hash,
        relay.event_block_number AS settlement_block_number
      FROM pact_records pr
      LEFT JOIN LATERAL (
        SELECT * FROM operations
        WHERE pact_record_id = pr.id ORDER BY updated_at DESC LIMIT 1
      ) op ON true
      LEFT JOIN LATERAL (
        SELECT cr.* FROM chain_reconciliations cr
        JOIN operations co ON co.id = cr.operation_id
        WHERE co.pact_record_id = pr.id ORDER BY cr.created_at DESC LIMIT 1
      ) chain ON true
      LEFT JOIN LATERAL (
        SELECT er.* FROM evidence_records er
        JOIN verification_attempts va ON va.evidence_hash = er.evidence_hash
        JOIN operations eo ON eo.id = va.operation_id
        WHERE eo.pact_record_id = pr.id ORDER BY va.created_at DESC LIMIT 1
      ) evidence ON true
      LEFT JOIN LATERAL (
        SELECT * FROM relay_intents
        WHERE pact_record_id = pr.id ORDER BY updated_at DESC LIMIT 1
      ) relay ON true
      WHERE pr.id = ${draft.linkedPactRecordId}
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) throw new Error("LINKED_PACT_RECORD_MISSING");
    const evidence =
      row.evidence_hash === null ||
      row.merge_commit_sha === null ||
      row.merged_at === null ||
      row.observed_at === null
        ? null
        : {
            evidenceHash: row.evidence_hash,
            mergeCommitSha: row.merge_commit_sha as `0x${string}`,
            mergedAt: BigInt(row.merged_at),
            observedAt: BigInt(row.observed_at),
          };
    const settlement: PublicSettlementSummary | null =
      row.canonical_tx_hash !== null &&
      (row.relay_state === "SETTLED" ||
        row.relay_state === "SETTLED_EXTERNALLY")
        ? {
            transactionHash: row.canonical_tx_hash,
            state: row.relay_state,
            blockNumber:
              row.settlement_block_number === null
                ? null
                : BigInt(row.settlement_block_number),
          }
        : null;
    return {
      draft,
      walletActions,
      operationState: row.operation_state,
      relayState: row.relay_state,
      chainJobStatus: row.chain_job_status,
      chainExpiredAt:
        row.chain_expired_at === null ? null : BigInt(row.chain_expired_at),
      now: BigInt(Math.floor(Date.now() / 1000)),
      jobId: BigInt(row.job_id),
      jobKey: row.job_key,
      completionDeadline: BigInt(row.completion_deadline),
      evidence,
      settlement,
    };
  }
}

export class InMemoryProductRepository implements ProductRepository {
  readonly #nonces = new Map<string, AuthNonce>();
  readonly #drafts = new Map<string, PactDraft>();
  readonly #idempotency = new Map<string, string>();

  async issueNonce(
    input: Omit<AuthNonce, "id" | "consumedAt">,
  ): Promise<AuthNonce> {
    for (const [nonce, existing] of this.#nonces) {
      if (
        existing.walletAddress === input.walletAddress &&
        existing.domain === input.domain &&
        existing.consumedAt === null
      ) {
        this.#nonces.set(
          nonce,
          Object.freeze({ ...existing, consumedAt: input.issuedAt }),
        );
      }
    }
    const created = Object.freeze({
      ...input,
      id: crypto.randomUUID(),
      consumedAt: null,
    });
    this.#nonces.set(created.nonce, created);
    return created;
  }

  async getNonce(nonce: string): Promise<AuthNonce | undefined> {
    return this.#nonces.get(nonce);
  }

  async consumeNonce(id: string, consumedAt: Date): Promise<boolean> {
    const entry = [...this.#nonces.entries()].find(
      ([, item]) => item.id === id,
    );
    if (entry === undefined) return false;
    const [nonce, existing] = entry;
    if (existing.consumedAt !== null || existing.expiresAt <= consumedAt)
      return false;
    this.#nonces.set(nonce, Object.freeze({ ...existing, consumedAt }));
    return true;
  }

  async createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
    const key = `${input.creatingWallet}:${input.idempotencyKey}`;
    const existingSlug = this.#idempotency.get(key);
    if (existingSlug !== undefined) {
      const existing = this.#drafts.get(existingSlug);
      if (existing === undefined) throw new Error("MEMORY_REPOSITORY_CORRUPT");
      return existing.canonicalRequestHash === input.canonicalRequestHash
        ? { kind: "REPLAY", draft: existing }
        : { kind: "CONFLICT" };
    }
    await Promise.resolve();
    const racedSlug = this.#idempotency.get(key);
    if (racedSlug !== undefined) return this.createDraft(input);
    const now = new Date();
    const draft: PactDraft = Object.freeze({
      id: crypto.randomUUID(),
      publicSlug: newSlug(),
      creatingWallet: input.creatingWallet,
      providerAddress: input.providerAddress,
      githubRepository: input.githubRepository,
      githubPullRequest: input.githubPullRequest,
      baseBranch: PRODUCT_BASE_BRANCH,
      event: PRODUCT_EVENT,
      amountBaseUnits: input.amountBaseUnits,
      network: PRODUCT_NETWORK,
      chainId: PRODUCT_CHAIN_ID,
      condition: input.condition,
      conditionHash: input.conditionHash,
      completionPolicyVersion: PRODUCT_COMPLETION_POLICY_VERSION,
      completionOffsetSeconds: PRODUCT_COMPLETION_OFFSET_SECONDS,
      expiryPolicyVersion: PRODUCT_EXPIRY_POLICY_VERSION,
      expiryOffsetSeconds: PRODUCT_EXPIRY_OFFSET_SECONDS,
      idempotencyKey: input.idempotencyKey,
      canonicalRequestHash: input.canonicalRequestHash,
      linkedPactRecordId: null,
      lifecycle: "ACTION_REQUIRED",
      createdAt: now,
      updatedAt: now,
    });
    this.#idempotency.set(key, draft.publicSlug);
    this.#drafts.set(draft.publicSlug, draft);
    return { kind: "CREATED", draft };
  }

  async getDraftByIdempotency(
    walletAddress: `0x${string}`,
    idempotencyKey: string,
  ): Promise<PactDraft | undefined> {
    const slug = this.#idempotency.get(`${walletAddress}:${idempotencyKey}`);
    return slug === undefined ? undefined : this.#drafts.get(slug);
  }

  async getDraftBySlug(slug: string): Promise<PactDraft | undefined> {
    return this.#drafts.get(slug);
  }

  async getPublicProjection(
    slug: string,
  ): Promise<ProductProjectionInput | undefined> {
    const draft = this.#drafts.get(slug);
    if (draft === undefined) return undefined;
    return {
      draft,
      walletActions: [],
      operationState: null,
      relayState: null,
      chainJobStatus: null,
      chainExpiredAt: null,
      now: BigInt(Math.floor(Date.now() / 1000)),
      jobId: null,
      jobKey: null,
      completionDeadline: null,
      evidence: null,
      settlement: null,
    };
  }
}
