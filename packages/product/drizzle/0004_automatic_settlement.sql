CREATE TABLE "pact_automation" (
  "id" uuid PRIMARY KEY NOT NULL,
  "draft_id" uuid NOT NULL,
  "pact_record_id" uuid NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "next_check_at" timestamptz DEFAULT now() NOT NULL,
  "last_check_at" timestamptz,
  "last_result" varchar(96),
  "consecutive_retryable_failures" integer DEFAULT 0 NOT NULL,
  "lease_owner" varchar(128),
  "lease_token" uuid,
  "lease_until" timestamptz,
  "last_operation_id" uuid,
  "last_wake_key" varchar(128),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "pact_automation_failures_nonnegative"
    CHECK ("consecutive_retryable_failures" >= 0),
  CONSTRAINT "pact_automation_lease_complete"
    CHECK (
      ("lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_until" IS NULL)
      OR
      ("lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_until" IS NOT NULL)
    ),
  CONSTRAINT "pact_automation_draft_fk"
    FOREIGN KEY ("draft_id") REFERENCES "pact_drafts"("id") ON DELETE RESTRICT,
  CONSTRAINT "pact_automation_pact_record_fk"
    FOREIGN KEY ("pact_record_id") REFERENCES "pact_records"("id") ON DELETE RESTRICT,
  CONSTRAINT "pact_automation_operation_fk"
    FOREIGN KEY ("last_operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "pact_automation_draft_uq"
  ON "pact_automation" ("draft_id");
CREATE UNIQUE INDEX "pact_automation_pact_record_uq"
  ON "pact_automation" ("pact_record_id");
CREATE INDEX "pact_automation_due_idx"
  ON "pact_automation" ("next_check_at")
  WHERE "enabled" = true;
CREATE INDEX "pact_automation_lease_idx"
  ON "pact_automation" ("lease_until")
  WHERE "lease_until" IS NOT NULL;

INSERT INTO "pact_automation" (
  "id", "draft_id", "pact_record_id", "next_check_at", "last_result"
)
SELECT gen_random_uuid(), pd."id", pd."linked_pact_record_id", now(),
  'MIGRATED_LINKED_DRAFT'
FROM "pact_drafts" pd
WHERE pd."linked_pact_record_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "wallet_actions" wa
    WHERE wa."draft_id" = pd."id"
      AND wa."action" = 'SUBMIT'
      AND wa."confirmation_status" = 'CONFIRMED'
  )
ON CONFLICT ("draft_id") DO NOTHING;
