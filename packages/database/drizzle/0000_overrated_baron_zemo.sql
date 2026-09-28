CREATE TABLE "attestations" (
	"digest" varchar(66) PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"pact_record_id" uuid NOT NULL,
	"job_key" varchar(66) NOT NULL,
	"evidence_hash" varchar(66) NOT NULL,
	"signer" varchar(42) NOT NULL,
	"chain_id" varchar(78) NOT NULL,
	"verifying_contract" varchar(42) NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"job_id" varchar(78) NOT NULL,
	"condition_hash" varchar(66) NOT NULL,
	"satisfied_at" varchar(20) NOT NULL,
	"verified_at" varchar(20) NOT NULL,
	"valid_until" varchar(20) NOT NULL,
	"signature" varchar(132) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attestations_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "attestations_time_order_valid" CHECK ("attestations"."satisfied_at"::numeric <= "attestations"."verified_at"::numeric and "attestations"."verified_at"::numeric <= "attestations"."valid_until"::numeric)
);
--> statement-breakpoint
CREATE TABLE "chain_reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"code" varchar(80),
	"block_number" varchar(78) NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"block_timestamp" varchar(20) NOT NULL,
	"chain_id" varchar(78) NOT NULL,
	"pact_evaluator" varchar(42) NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"job_id" varchar(78) NOT NULL,
	"job_key" varchar(66) NOT NULL,
	"binding_exists" boolean NOT NULL,
	"binding_condition_hash" varchar(66) NOT NULL,
	"binding_completion_deadline" varchar(20) NOT NULL,
	"binding_verifier" varchar(42) NOT NULL,
	"binding_accepted" boolean NOT NULL,
	"verifier_revoked" boolean NOT NULL,
	"job_client" varchar(42) NOT NULL,
	"job_provider" varchar(42) NOT NULL,
	"job_evaluator" varchar(42) NOT NULL,
	"job_status" integer NOT NULL,
	"job_expired_at" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_reconciliation_outcome_valid" CHECK ("chain_reconciliations"."outcome" in ('READY','RETRYABLE','INVALID')),
	CONSTRAINT "chain_reconciliation_job_status_valid" CHECK ("chain_reconciliations"."job_status" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"evidence_hash" varchar(66) PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"condition_hash" varchar(66) NOT NULL,
	"repository" varchar(140) NOT NULL,
	"pull_request" bigint NOT NULL,
	"base_branch" varchar(255) NOT NULL,
	"merge_commit_sha" varchar(42) NOT NULL,
	"merged_at" varchar(20) NOT NULL,
	"observed_at" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_records_pr_positive" CHECK ("evidence_records"."pull_request" > 0)
);
--> statement-breakpoint
CREATE TABLE "github_deliveries" (
	"delivery_id" varchar(36) PRIMARY KEY NOT NULL,
	"event" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"repository" varchar(140),
	"pull_request" bigint,
	"signature_valid" boolean NOT NULL,
	"processing_state" varchar(32) NOT NULL,
	"matched_pacts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "github_deliveries_signature_valid" CHECK ("github_deliveries"."signature_valid" = true),
	CONSTRAINT "github_deliveries_processing_state_valid" CHECK ("github_deliveries"."processing_state" in ('RECEIVED','IGNORED','ENQUEUED','NO_NEW_OPERATION'))
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pact_record_id" uuid NOT NULL,
	"trigger_kind" varchar(24) NOT NULL,
	"trigger_key" varchar(128) NOT NULL,
	"state" varchar(40) NOT NULL,
	"code" varchar(80),
	"retryable" boolean DEFAULT false NOT NULL,
	"retry_after_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_version_nonnegative" CHECK ("operations"."version" >= 0),
	CONSTRAINT "operations_trigger_kind_valid" CHECK ("operations"."trigger_kind" in ('GITHUB_WEBHOOK','MANUAL','RECOVERY')),
	CONSTRAINT "operations_state_valid" CHECK ("operations"."state" in ('PENDING','VERIFYING_GITHUB','NOT_SATISFIED_RETRYABLE','NOT_SATISFIED_TERMINAL','INDETERMINATE','VERIFIED','RECONCILING_CHAIN','CHAIN_RETRYABLE','CHAIN_INVALID','READY_TO_SIGN','SIGNING','READY_TO_RELAY','ALREADY_ACCEPTED','EXPIRED','FAILED_DEFINITE'))
);
--> statement-breakpoint
CREATE TABLE "pact_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chain_id" varchar(78) NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"pact_evaluator" varchar(42) NOT NULL,
	"job_id" varchar(78) NOT NULL,
	"job_key" varchar(66) NOT NULL,
	"condition_schema_version" integer NOT NULL,
	"condition_provider" varchar(16) NOT NULL,
	"condition_repository" varchar(140) NOT NULL,
	"condition_pull_request" bigint NOT NULL,
	"condition_base_branch" varchar(255) NOT NULL,
	"condition_event" varchar(32) NOT NULL,
	"condition_hash" varchar(66) NOT NULL,
	"completion_deadline" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pact_records_pr_positive" CHECK ("pact_records"."condition_pull_request" > 0)
);
--> statement-breakpoint
CREATE TABLE "verification_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"observed_at" varchar(20) NOT NULL,
	"result_status" varchar(24) NOT NULL,
	"reason" varchar(80),
	"retryable" boolean NOT NULL,
	"retry_after_seconds" integer,
	"rate_limit_remaining" integer,
	"rate_limit_reset_at" varchar(20),
	"evidence_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_attempt_number_positive" CHECK ("verification_attempts"."attempt_number" > 0),
	CONSTRAINT "verification_result_status_valid" CHECK ("verification_attempts"."result_status" in ('SATISFIED','NOT_SATISFIED','INDETERMINATE'))
);
--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_pact_record_id_pact_records_id_fk" FOREIGN KEY ("pact_record_id") REFERENCES "public"."pact_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_evidence_hash_evidence_records_evidence_hash_fk" FOREIGN KEY ("evidence_hash") REFERENCES "public"."evidence_records"("evidence_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_reconciliations" ADD CONSTRAINT "chain_reconciliations_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_pact_record_id_pact_records_id_fk" FOREIGN KEY ("pact_record_id") REFERENCES "public"."pact_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_evidence_hash_evidence_records_evidence_hash_fk" FOREIGN KEY ("evidence_hash") REFERENCES "public"."evidence_records"("evidence_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attestations_one_active_per_pact_uq" ON "attestations" USING btree ("pact_record_id") WHERE "attestations"."active" = true;--> statement-breakpoint
CREATE INDEX "attestations_job_key_idx" ON "attestations" USING btree ("job_key");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_reconciliations_sequence_uq" ON "chain_reconciliations" USING btree ("operation_id","attempt_number");--> statement-breakpoint
CREATE INDEX "chain_reconciliations_operation_idx" ON "chain_reconciliations" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_trigger_uq" ON "operations" USING btree ("pact_record_id","trigger_kind","trigger_key");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_one_active_per_pact_uq" ON "operations" USING btree ("pact_record_id") WHERE "operations"."state" in ('PENDING','VERIFYING_GITHUB','VERIFIED','RECONCILING_CHAIN','READY_TO_SIGN','SIGNING','READY_TO_RELAY');--> statement-breakpoint
CREATE INDEX "operations_state_idx" ON "operations" USING btree ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pact_records_chain_job_uq" ON "pact_records" USING btree ("chain_id","pact_evaluator","commerce_contract","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pact_records_job_key_uq" ON "pact_records" USING btree ("job_key");--> statement-breakpoint
CREATE INDEX "pact_records_github_lookup_idx" ON "pact_records" USING btree ("condition_repository","condition_pull_request");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_attempts_sequence_uq" ON "verification_attempts" USING btree ("operation_id","attempt_number");--> statement-breakpoint
CREATE INDEX "verification_attempts_operation_idx" ON "verification_attempts" USING btree ("operation_id","created_at");