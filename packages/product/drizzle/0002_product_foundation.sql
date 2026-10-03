CREATE TABLE "pact_drafts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "public_slug" varchar(64) NOT NULL,
  "creating_wallet" varchar(42) NOT NULL,
  "provider_address" varchar(42) NOT NULL,
  "github_repository" varchar(140) NOT NULL,
  "github_pull_request" bigint NOT NULL,
  "base_branch" varchar(255) NOT NULL,
  "event" varchar(32) NOT NULL,
  "amount_base_units" varchar(78) NOT NULL,
  "network" varchar(32) NOT NULL,
  "chain_id" varchar(78) NOT NULL,
  "condition_hash" varchar(66) NOT NULL,
  "completion_policy_version" integer NOT NULL,
  "completion_offset_seconds" integer NOT NULL,
  "expiry_policy_version" integer NOT NULL,
  "expiry_offset_seconds" integer NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "canonical_request_hash" varchar(66) NOT NULL,
  "linked_pact_record_id" uuid,
  "lifecycle" varchar(32) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "pact_drafts_pr_positive" CHECK ("github_pull_request" > 0),
  CONSTRAINT "pact_drafts_amount_positive" CHECK ("amount_base_units" ~ '^[1-9][0-9]*$'),
  CONSTRAINT "pact_drafts_slug_valid" CHECK ("public_slug" ~ '^pact_[a-f0-9]{32}$'),
  CONSTRAINT "pact_drafts_creator_valid" CHECK ("creating_wallet" ~ '^0x[0-9A-Fa-f]{40}$'),
  CONSTRAINT "pact_drafts_provider_valid" CHECK ("provider_address" ~ '^0x[0-9A-Fa-f]{40}$'),
  CONSTRAINT "pact_drafts_condition_hash_valid" CHECK ("condition_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  CONSTRAINT "pact_drafts_request_hash_valid" CHECK ("canonical_request_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  CONSTRAINT "pact_drafts_idempotency_valid" CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT "pact_drafts_event_valid" CHECK ("event" = 'PR_MERGED'),
  CONSTRAINT "pact_drafts_network_valid" CHECK ("network" = 'arc-testnet'),
  CONSTRAINT "pact_drafts_chain_valid" CHECK ("chain_id" = '5042002'),
  CONSTRAINT "pact_drafts_lifecycle_valid" CHECK ("lifecycle" IN ('DRAFT','ACTION_REQUIRED','LINKED')),
  CONSTRAINT "pact_drafts_linked_pact_fk" FOREIGN KEY ("linked_pact_record_id") REFERENCES "pact_records"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "pact_drafts_public_slug_uq" ON "pact_drafts" ("public_slug");
CREATE UNIQUE INDEX "pact_drafts_creator_idempotency_uq" ON "pact_drafts" ("creating_wallet", "idempotency_key");
CREATE INDEX "pact_drafts_linked_pact_idx" ON "pact_drafts" ("linked_pact_record_id");

CREATE TABLE "wallet_actions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "draft_id" uuid NOT NULL REFERENCES "pact_drafts"("id") ON DELETE RESTRICT,
  "pact_record_id" uuid REFERENCES "pact_records"("id") ON DELETE RESTRICT,
  "action" varchar(32) NOT NULL,
  "required_signer" varchar(42) NOT NULL,
  "chain_id" varchar(78) NOT NULL,
  "expected_target" varchar(42) NOT NULL,
  "value" varchar(78) NOT NULL,
  "calldata_hash" varchar(66) NOT NULL,
  "preparation_version" integer NOT NULL,
  "transaction_hash" varchar(66),
  "confirmation_status" varchar(24) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "wallet_actions_kind_valid" CHECK ("action" IN ('CREATE_JOB','BIND_CONDITION','SET_BUDGET','APPROVE_USDC','FUND','SUBMIT')),
  CONSTRAINT "wallet_actions_confirmation_valid" CHECK ("confirmation_status" IN ('PENDING','SUBMITTED','CONFIRMED','FAILED')),
  CONSTRAINT "wallet_actions_chain_valid" CHECK ("chain_id" = '5042002'),
  CONSTRAINT "wallet_actions_value_valid" CHECK ("value" ~ '^[0-9]+$'),
  CONSTRAINT "wallet_actions_signer_valid" CHECK ("required_signer" ~ '^0x[0-9A-Fa-f]{40}$'),
  CONSTRAINT "wallet_actions_target_valid" CHECK ("expected_target" ~ '^0x[0-9A-Fa-f]{40}$'),
  CONSTRAINT "wallet_actions_calldata_hash_valid" CHECK ("calldata_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  CONSTRAINT "wallet_actions_transaction_hash_valid" CHECK ("transaction_hash" IS NULL OR "transaction_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  CONSTRAINT "wallet_actions_idempotency_valid" CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{8,128}$')
);
CREATE UNIQUE INDEX "wallet_actions_signer_idempotency_uq" ON "wallet_actions" ("required_signer", "idempotency_key");
CREATE INDEX "wallet_actions_draft_idx" ON "wallet_actions" ("draft_id", "created_at");

CREATE TABLE "auth_nonces" (
  "id" uuid PRIMARY KEY NOT NULL,
  "wallet_address" varchar(42) NOT NULL,
  "domain" varchar(255) NOT NULL,
  "uri" text NOT NULL,
  "nonce" varchar(64) NOT NULL,
  "chain_id" varchar(78) NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  CONSTRAINT "auth_nonces_chain_valid" CHECK ("chain_id" = '5042002'),
  CONSTRAINT "auth_nonces_expiry_valid" CHECK ("expires_at" > "issued_at"),
  CONSTRAINT "auth_nonces_wallet_valid" CHECK ("wallet_address" ~ '^0x[0-9A-Fa-f]{40}$'),
  CONSTRAINT "auth_nonces_nonce_valid" CHECK ("nonce" ~ '^[A-Za-z0-9_-]{20,64}$')
);
CREATE UNIQUE INDEX "auth_nonces_nonce_uq" ON "auth_nonces" ("nonce");
CREATE UNIQUE INDEX "auth_nonces_active_wallet_domain_uq" ON "auth_nonces" ("wallet_address", "domain") WHERE "consumed_at" IS NULL;
CREATE INDEX "auth_nonces_expiry_idx" ON "auth_nonces" ("expires_at");

CREATE FUNCTION pact_guard_product_draft_core() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM wallet_actions
    WHERE draft_id = OLD.id AND confirmation_status = 'CONFIRMED'
  ) AND ROW(
    NEW.creating_wallet, NEW.provider_address, NEW.github_repository,
    NEW.github_pull_request, NEW.base_branch, NEW.event,
    NEW.amount_base_units, NEW.network, NEW.chain_id,
    NEW.condition_hash, NEW.completion_policy_version,
    NEW.completion_offset_seconds, NEW.expiry_policy_version,
    NEW.expiry_offset_seconds
  ) IS DISTINCT FROM ROW(
    OLD.creating_wallet, OLD.provider_address, OLD.github_repository,
    OLD.github_pull_request, OLD.base_branch, OLD.event,
    OLD.amount_base_units, OLD.network, OLD.chain_id,
    OLD.condition_hash, OLD.completion_policy_version,
    OLD.completion_offset_seconds, OLD.expiry_policy_version,
    OLD.expiry_offset_seconds
  ) THEN
    RAISE EXCEPTION 'draft core is immutable after a confirmed wallet action'
      USING ERRCODE = '23514', CONSTRAINT = 'pact_drafts_confirmed_core_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pact_drafts_core_guard
BEFORE UPDATE ON pact_drafts
FOR EACH ROW EXECUTE FUNCTION pact_guard_product_draft_core();
