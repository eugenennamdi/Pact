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
  PRODUCT_COMPLETION_OFFSET_SECONDS,
  PRODUCT_COMPLETION_POLICY_VERSION,
  PRODUCT_EVENT,
  PRODUCT_EXPIRY_OFFSET_SECONDS,
  PRODUCT_EXPIRY_POLICY_VERSION,
} from "./constants";
import { loadCertifiedProductDeployment } from "./deployment";
import { PERSISTED_PRODUCT_NETWORK } from "./network";
import type {
  AuthNonce,
  CreateDraftInput,
  CreateDraftResult,
  ConfirmWalletActionInput,
  PactDraft,
  PreparedWalletActionInput,
  ProductProjectionInput,
  ProductRepository,
  PublicSettlementSummary,
  SavePreparedActionResult,
  WalletAction,
  WalletActionKind,
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
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const PERSISTED_PRODUCT_DEPLOYMENT = loadCertifiedProductDeployment(
  PERSISTED_PRODUCT_NETWORK,
);

interface NonceRow {
  readonly id: string;
  readonly wallet_address: string;
  readonly domain: string;
  readonly uri: string;
  readonly nonce: string;
  readonly chain_id: string;
  readonly issued_at: Date | string;
  readonly expires_at: Date | string;
  readonly consumed_at: Date | string | null;
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
  readonly semantic_hash: string;
  readonly preparation_version: number;
  readonly prepared_at_block: string;
  readonly prepared_at_block_hash: string | null;
  readonly preparation_expires_at: Date | string;
  readonly expected_state_transition: string;
  readonly completion_deadline: string | null;
  readonly job_expired_at: string | null;
  readonly transaction_hash: string | null;
  readonly confirmation_status: WalletAction["confirmationStatus"];
  readonly idempotency_key: string;
  readonly confirmed_job_id: string | null;
  readonly confirmed_job_key: string | null;
  readonly confirmed_job_status: number | null;
  readonly confirmed_at_block: string | null;
  readonly confirmed_at_block_hash: string | null;
  readonly confirmed_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function timestamp(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error("INVALID_DATABASE_TIMESTAMP");
  return parsed;
}

function nullableTimestamp(value: Date | string | null): Date | null {
  return value === null ? null : timestamp(value);
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
    row.network !== PERSISTED_PRODUCT_NETWORK.id ||
    BigInt(row.chain_id) !== PERSISTED_PRODUCT_NETWORK.chainId ||
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
    network: PERSISTED_PRODUCT_NETWORK.id,
    chainId: PERSISTED_PRODUCT_NETWORK.chainId,
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
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
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
    issuedAt: timestamp(row.issued_at),
    expiresAt: timestamp(row.expires_at),
    consumedAt: nullableTimestamp(row.consumed_at),
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
    semanticHash: row.semantic_hash as Hex32,
    preparationVersion: row.preparation_version,
    preparedAtBlock: BigInt(row.prepared_at_block),
    preparedAtBlockHash: row.prepared_at_block_hash as Hex32 | null,
    preparationExpiresAt: timestamp(row.preparation_expires_at),
    expectedStateTransition: row.expected_state_transition,
    completionDeadline:
      row.completion_deadline === null ? null : BigInt(row.completion_deadline),
    jobExpiredAt:
      row.job_expired_at === null ? null : BigInt(row.job_expired_at),
    transactionHash: row.transaction_hash as Hex32 | null,
    confirmationStatus: row.confirmation_status,
    idempotencyKey: row.idempotency_key,
    confirmedJobId:
      row.confirmed_job_id === null ? null : BigInt(row.confirmed_job_id),
    confirmedJobKey: row.confirmed_job_key as Hex32 | null,
    confirmedJobStatus: row.confirmed_job_status,
    confirmedAtBlock:
      row.confirmed_at_block === null ? null : BigInt(row.confirmed_at_block),
    confirmedAtBlockHash: row.confirmed_at_block_hash as Hex32 | null,
    confirmedAt: nullableTimestamp(row.confirmed_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
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
        SET consumed_at = ${input.issuedAt.toISOString()}
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
          ${input.issuedAt.toISOString()}, ${input.expiresAt.toISOString()}
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
      SET consumed_at = ${consumedAt.toISOString()}
      WHERE id = ${id}
        AND consumed_at IS NULL
        AND expires_at > ${consumedAt.toISOString()}
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
        ${input.amountBaseUnits.toString()}, ${input.network},
        ${input.chainId.toString()}, ${input.conditionHash},
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

  async getWalletAction(
    draftId: string,
    action: WalletActionKind,
  ): Promise<WalletAction | undefined> {
    const rows = await this.#database.sql<WalletActionRow[]>`
      SELECT * FROM wallet_actions
      WHERE draft_id = ${draftId} AND action = ${action}
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapWalletAction(rows[0]);
  }

  async savePreparedAction(
    input: PreparedWalletActionInput,
  ): Promise<SavePreparedActionResult> {
    return this.#database.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${input.draftId}:${input.action}`}))`;
      const existingRows = await transaction<WalletActionRow[]>`
        SELECT * FROM wallet_actions
        WHERE draft_id = ${input.draftId} AND action = ${input.action}
        FOR UPDATE
      `;
      const existingRow = existingRows[0];
      if (existingRow !== undefined) {
        const existing = mapWalletAction(existingRow);
        if (existing.confirmationStatus === "CONFIRMED") {
          return { kind: "ALREADY_CONFIRMED" as const, action: existing };
        }
        if (
          existing.idempotencyKey !== input.idempotencyKey ||
          existing.semanticHash !== input.semanticHash
        ) {
          return { kind: "CONFLICT" as const, action: existing };
        }
        if (
          existing.preparationExpiresAt > new Date() &&
          existing.calldataHash === input.calldataHash &&
          existing.requiredSigner === input.requiredSigner &&
          existing.expectedTarget === input.expectedTarget &&
          existing.value === input.value
        ) {
          return { kind: "REPLAY" as const, action: existing };
        }
        const refreshedRows = await transaction<WalletActionRow[]>`
          UPDATE wallet_actions SET
            pact_record_id = ${input.pactRecordId},
            required_signer = ${input.requiredSigner},
            chain_id = ${input.chainId.toString()},
            expected_target = ${input.expectedTarget},
            value = ${input.value.toString()},
            calldata_hash = ${input.calldataHash},
            semantic_hash = ${input.semanticHash},
            preparation_version = ${input.preparationVersion},
            prepared_at_block = ${input.preparedAtBlock.toString()},
            prepared_at_block_hash = ${input.preparedAtBlockHash},
            preparation_expires_at = ${input.preparationExpiresAt.toISOString()},
            expected_state_transition = ${input.expectedStateTransition},
            completion_deadline = ${input.completionDeadline?.toString() ?? null},
            job_expired_at = ${input.jobExpiredAt?.toString() ?? null},
            transaction_hash = NULL,
            confirmation_status = 'PENDING',
            updated_at = now()
          WHERE id = ${existing.id}
          RETURNING *
        `;
        const refreshed = refreshedRows[0];
        if (refreshed === undefined)
          throw new Error("WALLET_ACTION_REFRESH_FAILED");
        return {
          kind: "REFRESHED" as const,
          action: mapWalletAction(refreshed),
        };
      }
      const rows = await transaction<WalletActionRow[]>`
        INSERT INTO wallet_actions (
          id, draft_id, pact_record_id, action, required_signer, chain_id,
          expected_target, value, calldata_hash, semantic_hash,
          preparation_version, prepared_at_block, prepared_at_block_hash,
          preparation_expires_at, expected_state_transition,
          completion_deadline, job_expired_at, confirmation_status,
          idempotency_key
        ) VALUES (
          ${crypto.randomUUID()}, ${input.draftId}, ${input.pactRecordId},
          ${input.action}, ${input.requiredSigner}, ${input.chainId.toString()},
          ${input.expectedTarget}, ${input.value.toString()},
          ${input.calldataHash}, ${input.semanticHash},
          ${input.preparationVersion}, ${input.preparedAtBlock.toString()},
          ${input.preparedAtBlockHash}, ${input.preparationExpiresAt.toISOString()},
          ${input.expectedStateTransition},
          ${input.completionDeadline?.toString() ?? null},
          ${input.jobExpiredAt?.toString() ?? null}, 'PENDING',
          ${input.idempotencyKey}
        ) RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("WALLET_ACTION_INSERT_FAILED");
      return { kind: "CREATED" as const, action: mapWalletAction(row) };
    });
  }

  async confirmWalletAction(
    input: ConfirmWalletActionInput,
  ): Promise<WalletAction> {
    try {
      return await this.#database.sql.begin(async (transaction) => {
        const existingRows = await transaction<WalletActionRow[]>`
        SELECT * FROM wallet_actions WHERE id = ${input.actionId} FOR UPDATE
      `;
        const existingRow = existingRows[0];
        if (existingRow === undefined)
          throw new Error("WALLET_ACTION_NOT_FOUND");
        const existing = mapWalletAction(existingRow);
        if (existing.confirmationStatus === "CONFIRMED") {
          if (existing.transactionHash !== input.transactionHash)
            throw new Error("TRANSACTION_CONFIRMATION_CONFLICT");
          return existing;
        }
        const claimed =
          input.transactionHash === null
            ? []
            : await transaction<{ readonly id: string }[]>`
              SELECT id FROM wallet_actions
              WHERE transaction_hash = ${input.transactionHash}
                AND id <> ${input.actionId}
              LIMIT 1
            `;
        if (claimed.length !== 0)
          throw new Error("TRANSACTION_ALREADY_CLAIMED");
        if (input.linkedPactRecordId !== undefined) {
          const linked = await transaction<{ readonly id: string }[]>`
          UPDATE pact_drafts SET
            linked_pact_record_id = ${input.linkedPactRecordId},
            lifecycle = 'LINKED', updated_at = now()
          WHERE id = ${existing.draftId}
            AND (linked_pact_record_id IS NULL
              OR linked_pact_record_id = ${input.linkedPactRecordId})
          RETURNING id
        `;
          if (linked.length !== 1) throw new Error("PACT_DRAFT_LINK_CONFLICT");
        }
        const rows = await transaction<WalletActionRow[]>`
        UPDATE wallet_actions SET
          pact_record_id = ${input.linkedPactRecordId ?? existing.pactRecordId},
          transaction_hash = ${input.transactionHash},
          confirmation_status = 'CONFIRMED',
          confirmed_job_id = ${input.confirmedJobId?.toString() ?? null},
          confirmed_job_key = ${input.confirmedJobKey},
          confirmed_job_status = ${input.confirmedJobStatus},
          confirmed_at_block = ${input.confirmedAtBlock.toString()},
          confirmed_at_block_hash = ${input.confirmedAtBlockHash},
          confirmed_at = ${input.confirmedAt.toISOString()}, updated_at = now()
        WHERE id = ${input.actionId} AND confirmation_status <> 'CONFIRMED'
        RETURNING *
      `;
        const row = rows[0];
        if (row === undefined) throw new Error("WALLET_ACTION_CONFIRM_FAILED");
        return mapWalletAction(row);
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "wallet_actions_transaction_hash_uq"
      ) {
        throw new Error("TRANSACTION_ALREADY_CLAIMED");
      }
      throw error;
    }
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
    const latestConfirmedAction = [...walletActions]
      .reverse()
      .find((action) => action.confirmationStatus === "CONFIRMED");
    const createAction = walletActions.find(
      (action) => action.action === "CREATE_JOB",
    );
    if (draft.linkedPactRecordId === null) {
      return {
        draft,
        walletActions,
        operationState: null,
        relayState: null,
        chainJobStatus: latestConfirmedAction?.confirmedJobStatus ?? null,
        chainExpiredAt: createAction?.jobExpiredAt ?? null,
        now: BigInt(Math.floor(Date.now() / 1000)),
        jobId: createAction?.confirmedJobId ?? null,
        jobKey: createAction?.confirmedJobKey ?? null,
        completionDeadline: createAction?.completionDeadline ?? null,
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
        readonly evidence_condition_hash: Hex32 | null;
        readonly evidence_repository: string | null;
        readonly evidence_pull_request: number | null;
        readonly evidence_base_branch: string | null;
        readonly merge_commit_sha: string | null;
        readonly merged_at: string | null;
        readonly observed_at: string | null;
        readonly attestation_digest: Hex32 | null;
        readonly attestation_verifier: string | null;
        readonly satisfied_at: string | null;
        readonly verified_at: string | null;
        readonly valid_until: string | null;
        readonly canonical_tx_hash: Hex32 | null;
        readonly receipt_block_number: string | null;
        readonly receipt_block_hash: Hex32 | null;
        readonly receipt_transaction_index: number | null;
        readonly event_block_number: string | null;
        readonly event_block_hash: Hex32 | null;
        readonly event_log_index: number | null;
        readonly broadcast_attempt_count: number | null;
      }[]
    >`
      SELECT pr.job_id, pr.job_key, pr.completion_deadline,
        op.state AS operation_state,
        relay.state AS relay_state,
        chain.job_status AS chain_job_status,
        chain.job_expired_at AS chain_expired_at,
        evidence.evidence_hash,
        evidence.condition_hash AS evidence_condition_hash,
        evidence.repository AS evidence_repository,
        evidence.pull_request AS evidence_pull_request,
        evidence.base_branch AS evidence_base_branch,
        evidence.merge_commit_sha,
        evidence.merged_at, evidence.observed_at,
        att.digest AS attestation_digest,
        att.signer AS attestation_verifier,
        att.satisfied_at, att.verified_at, att.valid_until,
        relay.canonical_tx_hash,
        relay.receipt_block_number, relay.receipt_block_hash,
        relay.receipt_transaction_index,
        relay.event_block_number, relay.event_block_hash,
        relay.event_log_index, relay.broadcast_attempt_count
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
        SELECT a.* FROM attestations a
        WHERE a.pact_record_id = pr.id AND a.active = true
        ORDER BY a.created_at DESC LIMIT 1
      ) att ON true
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
      row.evidence_condition_hash === null ||
      row.evidence_repository === null ||
      row.evidence_pull_request === null ||
      row.evidence_base_branch === null ||
      row.merge_commit_sha === null ||
      row.merged_at === null ||
      row.observed_at === null ||
      row.attestation_digest === null ||
      row.attestation_verifier === null ||
      row.satisfied_at === null ||
      row.verified_at === null ||
      row.valid_until === null
        ? null
        : {
            conditionHash: row.evidence_condition_hash,
            evidenceHash: row.evidence_hash,
            repository: row.evidence_repository,
            pullRequest: row.evidence_pull_request,
            baseBranch: row.evidence_base_branch,
            mergeCommitSha: row.merge_commit_sha as `0x${string}`,
            mergedAt: BigInt(row.merged_at),
            observedAt: BigInt(row.observed_at),
            attestationDigest: row.attestation_digest,
            verifier: getAddress(row.attestation_verifier),
            satisfiedAt: BigInt(row.satisfied_at),
            verifiedAt: BigInt(row.verified_at),
            validUntil: BigInt(row.valid_until),
          };
    const settlement: PublicSettlementSummary | null =
      row.canonical_tx_hash !== null &&
      row.receipt_block_number !== null &&
      row.receipt_block_hash !== null &&
      row.receipt_transaction_index !== null &&
      row.event_block_number !== null &&
      row.event_block_hash !== null &&
      row.event_log_index !== null &&
      row.broadcast_attempt_count !== null &&
      row.evidence_hash !== null &&
      (row.relay_state === "SETTLED" ||
        row.relay_state === "SETTLED_EXTERNALLY")
        ? {
            jobId: BigInt(row.job_id),
            jobKey: row.job_key,
            chainId: draft.chainId,
            commerce: PERSISTED_PRODUCT_DEPLOYMENT.commerce,
            evaluator: PERSISTED_PRODUCT_DEPLOYMENT.evaluator,
            transactionHash: row.canonical_tx_hash,
            state: row.relay_state,
            receiptBlockNumber: BigInt(row.receipt_block_number),
            receiptBlockHash: row.receipt_block_hash,
            receiptTransactionIndex: row.receipt_transaction_index,
            eventBlockNumber: BigInt(row.event_block_number),
            eventBlockHash: row.event_block_hash,
            eventLogIndex: row.event_log_index,
            finalJobStatus: 3,
            bindingAccepted: true,
            broadcastAttemptCount: row.broadcast_attempt_count,
            grossBudget: draft.amountBaseUnits,
            grossProviderPayout: draft.amountBaseUnits,
            treasuryApplicationPayout: 0n,
            evaluatorApplicationPayout: 0n,
            evidenceHash: row.evidence_hash,
            completionReason: row.evidence_hash,
          }
        : null;
    return {
      draft,
      walletActions,
      operationState: row.operation_state,
      relayState: row.relay_state,
      chainJobStatus:
        settlement === null
          ? (row.chain_job_status ??
            latestConfirmedAction?.confirmedJobStatus ??
            null)
          : 3,
      chainExpiredAt:
        row.chain_expired_at === null
          ? (createAction?.jobExpiredAt ?? null)
          : BigInt(row.chain_expired_at),
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
  readonly #actions = new Map<string, WalletAction>();

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
      network: input.network,
      chainId: input.chainId,
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

  async getWalletAction(
    draftId: string,
    action: WalletActionKind,
  ): Promise<WalletAction | undefined> {
    return this.#actions.get(`${draftId}:${action}`);
  }

  async savePreparedAction(
    input: PreparedWalletActionInput,
  ): Promise<SavePreparedActionResult> {
    const key = `${input.draftId}:${input.action}`;
    const existing = this.#actions.get(key);
    if (existing !== undefined) {
      if (existing.confirmationStatus === "CONFIRMED")
        return { kind: "ALREADY_CONFIRMED", action: existing };
      if (
        existing.idempotencyKey !== input.idempotencyKey ||
        existing.semanticHash !== input.semanticHash
      ) {
        return { kind: "CONFLICT", action: existing };
      }
      if (
        existing.preparationExpiresAt > new Date() &&
        existing.calldataHash === input.calldataHash
      ) {
        return { kind: "REPLAY", action: existing };
      }
      const refreshed = Object.freeze({
        ...existing,
        ...input,
        transactionHash: null,
        confirmationStatus: "PENDING" as const,
        updatedAt: new Date(),
      });
      this.#actions.set(key, refreshed);
      return { kind: "REFRESHED", action: refreshed };
    }
    const now = new Date();
    const created: WalletAction = Object.freeze({
      ...input,
      id: crypto.randomUUID(),
      transactionHash: null,
      confirmationStatus: "PENDING",
      confirmedJobId: null,
      confirmedJobKey: null,
      confirmedJobStatus: null,
      confirmedAtBlock: null,
      confirmedAtBlockHash: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.#actions.set(key, created);
    return { kind: "CREATED", action: created };
  }

  async confirmWalletAction(
    input: ConfirmWalletActionInput,
  ): Promise<WalletAction> {
    const entry = [...this.#actions.entries()].find(
      ([, action]) => action.id === input.actionId,
    );
    if (entry === undefined) throw new Error("WALLET_ACTION_NOT_FOUND");
    const [key, existing] = entry;
    if (existing.confirmationStatus === "CONFIRMED") {
      if (existing.transactionHash !== input.transactionHash)
        throw new Error("TRANSACTION_CONFIRMATION_CONFLICT");
      return existing;
    }
    if (
      input.transactionHash !== null &&
      [...this.#actions.values()].some(
        (action) =>
          action.id !== input.actionId &&
          action.transactionHash === input.transactionHash,
      )
    ) {
      throw new Error("TRANSACTION_ALREADY_CLAIMED");
    }
    const confirmed = Object.freeze({
      ...existing,
      pactRecordId: input.linkedPactRecordId ?? existing.pactRecordId,
      transactionHash: input.transactionHash,
      confirmationStatus: "CONFIRMED" as const,
      confirmedJobId: input.confirmedJobId,
      confirmedJobKey: input.confirmedJobKey,
      confirmedJobStatus: input.confirmedJobStatus,
      confirmedAtBlock: input.confirmedAtBlock,
      confirmedAtBlockHash: input.confirmedAtBlockHash,
      confirmedAt: input.confirmedAt,
      updatedAt: input.confirmedAt,
    });
    this.#actions.set(key, confirmed);
    if (input.linkedPactRecordId !== undefined) {
      const draft = this.#drafts.get(
        [...this.#drafts.keys()].find(
          (slug) => this.#drafts.get(slug)?.id === existing.draftId,
        ) ?? "",
      );
      if (draft !== undefined) {
        this.#drafts.set(
          draft.publicSlug,
          Object.freeze({
            ...draft,
            linkedPactRecordId: input.linkedPactRecordId,
            lifecycle: "LINKED" as const,
            updatedAt: input.confirmedAt,
          }),
        );
      }
    }
    return confirmed;
  }

  async getPublicProjection(
    slug: string,
  ): Promise<ProductProjectionInput | undefined> {
    const draft = this.#drafts.get(slug);
    if (draft === undefined) return undefined;
    return {
      draft,
      walletActions: [...this.#actions.values()]
        .filter((action) => action.draftId === draft.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      operationState: null,
      relayState: null,
      chainJobStatus:
        [...this.#actions.values()]
          .filter((action) => action.draftId === draft.id)
          .at(-1)?.confirmedJobStatus ?? null,
      chainExpiredAt:
        [...this.#actions.values()].find(
          (action) =>
            action.draftId === draft.id && action.action === "CREATE_JOB",
        )?.jobExpiredAt ?? null,
      now: BigInt(Math.floor(Date.now() / 1000)),
      jobId:
        [...this.#actions.values()].find(
          (action) =>
            action.draftId === draft.id && action.action === "CREATE_JOB",
        )?.confirmedJobId ?? null,
      jobKey:
        [...this.#actions.values()].find(
          (action) =>
            action.draftId === draft.id && action.action === "CREATE_JOB",
        )?.confirmedJobKey ?? null,
      completionDeadline:
        [...this.#actions.values()].find(
          (action) =>
            action.draftId === draft.id && action.action === "CREATE_JOB",
        )?.completionDeadline ?? null,
      evidence: null,
      settlement: null,
    };
  }
}
