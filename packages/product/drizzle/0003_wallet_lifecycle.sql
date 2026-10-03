ALTER TABLE "wallet_actions"
  ADD COLUMN "semantic_hash" varchar(66),
  ADD COLUMN "prepared_at_block" varchar(78),
  ADD COLUMN "prepared_at_block_hash" varchar(66),
  ADD COLUMN "preparation_expires_at" timestamptz,
  ADD COLUMN "expected_state_transition" varchar(64),
  ADD COLUMN "completion_deadline" varchar(78),
  ADD COLUMN "job_expired_at" varchar(78),
  ADD COLUMN "confirmed_job_id" varchar(78),
  ADD COLUMN "confirmed_job_key" varchar(66),
  ADD COLUMN "confirmed_job_status" integer,
  ADD COLUMN "confirmed_at_block" varchar(78),
  ADD COLUMN "confirmed_at_block_hash" varchar(66),
  ADD COLUMN "confirmed_at" timestamptz;

UPDATE "wallet_actions" SET
  "semantic_hash" = "calldata_hash",
  "prepared_at_block" = '0',
  "preparation_expires_at" = "created_at",
  "expected_state_transition" = 'LEGACY_PREPARATION'
WHERE "semantic_hash" IS NULL;

UPDATE "wallet_actions" SET
  "confirmed_at" = "updated_at"
WHERE "confirmation_status" = 'CONFIRMED' AND "confirmed_at" IS NULL;

ALTER TABLE "wallet_actions"
  ALTER COLUMN "semantic_hash" SET NOT NULL,
  ALTER COLUMN "prepared_at_block" SET NOT NULL,
  ALTER COLUMN "preparation_expires_at" SET NOT NULL,
  ALTER COLUMN "expected_state_transition" SET NOT NULL;

ALTER TABLE "wallet_actions"
  ADD CONSTRAINT "wallet_actions_semantic_hash_valid"
    CHECK ("semantic_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "wallet_actions_prepared_block_valid"
    CHECK ("prepared_at_block" ~ '^[0-9]+$'),
  ADD CONSTRAINT "wallet_actions_prepared_block_hash_valid"
    CHECK ("prepared_at_block_hash" IS NULL OR "prepared_at_block_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "wallet_actions_deadlines_valid"
    CHECK (("completion_deadline" IS NULL OR "completion_deadline" ~ '^[0-9]+$')
      AND ("job_expired_at" IS NULL OR "job_expired_at" ~ '^[0-9]+$')),
  ADD CONSTRAINT "wallet_actions_confirmed_job_valid"
    CHECK (("confirmed_job_id" IS NULL OR "confirmed_job_id" ~ '^[1-9][0-9]*$')
      AND ("confirmed_job_key" IS NULL OR "confirmed_job_key" ~ '^0x[0-9A-Fa-f]{64}$')
      AND ("confirmed_job_status" IS NULL OR "confirmed_job_status" BETWEEN 0 AND 5)),
  ADD CONSTRAINT "wallet_actions_confirmed_block_valid"
    CHECK (("confirmed_at_block" IS NULL OR "confirmed_at_block" ~ '^[0-9]+$')
      AND ("confirmed_at_block_hash" IS NULL OR "confirmed_at_block_hash" ~ '^0x[0-9A-Fa-f]{64}$')),
  ADD CONSTRAINT "wallet_actions_confirmation_metadata_valid"
    CHECK (
      ("confirmation_status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL)
      OR ("confirmation_status" <> 'CONFIRMED' AND "confirmed_at" IS NULL)
    );

CREATE UNIQUE INDEX "wallet_actions_draft_action_uq"
  ON "wallet_actions" ("draft_id", "action");
CREATE UNIQUE INDEX "wallet_actions_transaction_hash_uq"
  ON "wallet_actions" ("transaction_hash")
  WHERE "transaction_hash" IS NOT NULL;
CREATE INDEX "wallet_actions_expiry_idx"
  ON "wallet_actions" ("preparation_expires_at")
  WHERE "confirmation_status" = 'PENDING';
