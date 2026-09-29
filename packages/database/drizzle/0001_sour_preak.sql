CREATE TABLE "relay_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pact_record_id" uuid NOT NULL,
	"attestation_digest" varchar(66) NOT NULL,
	"state" varchar(48) NOT NULL,
	"code" varchar(80),
	"retryable" boolean DEFAULT false NOT NULL,
	"chain_id" varchar(78) NOT NULL,
	"relay_address" varchar(42) NOT NULL,
	"pact_evaluator" varchar(42) NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"nonce" varchar(20),
	"calldata" text,
	"serialized_transaction" text,
	"expected_tx_hash" varchar(66),
	"transaction_type" varchar(16),
	"gas_limit" varchar(78),
	"gas_price" varchar(78),
	"max_fee_per_gas" varchar(78),
	"max_priority_fee_per_gas" varchar(78),
	"pre_dispatch_block_number" varchar(78),
	"pre_dispatch_block_hash" varchar(66),
	"broadcast_attempt_count" integer DEFAULT 0 NOT NULL,
	"returned_tx_hash" varchar(66),
	"receipt_status" varchar(12),
	"receipt_block_number" varchar(78),
	"receipt_block_hash" varchar(66),
	"receipt_transaction_index" integer,
	"canonical_tx_hash" varchar(66),
	"event_block_number" varchar(78),
	"event_block_hash" varchar(66),
	"event_log_index" integer,
	"event_relayer" varchar(42),
	"event_verifier" varchar(42),
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_intents_version_nonnegative" CHECK ("relay_intents"."version" >= 0),
	CONSTRAINT "relay_intents_broadcast_count_valid" CHECK ("relay_intents"."broadcast_attempt_count" between 0 and 1),
	CONSTRAINT "relay_intents_state_valid" CHECK ("relay_intents"."state" in ('PREPARING','SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN','SETTLED','SETTLED_EXTERNALLY','COMPLETED_BY_DIFFERENT_ATTESTATION','REVERTED','INTEGRITY_FAILURE','EXPIRED_UNSENT','PRECONDITION_FAILED','NONCE_DRIFT','INSUFFICIENT_RELAY_GAS')),
	CONSTRAINT "relay_intents_dispatch_identity_valid" CHECK ("relay_intents"."state" not in ('SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN','SETTLED','REVERTED') or ("relay_intents"."nonce" is not null and "relay_intents"."calldata" is not null and "relay_intents"."serialized_transaction" is not null and "relay_intents"."expected_tx_hash" is not null and "relay_intents"."gas_limit" is not null and "relay_intents"."transaction_type" is not null and "relay_intents"."pre_dispatch_block_number" is not null and "relay_intents"."pre_dispatch_block_hash" is not null))
);
--> statement-breakpoint
ALTER TABLE "relay_intents" ADD CONSTRAINT "relay_intents_pact_record_id_pact_records_id_fk" FOREIGN KEY ("pact_record_id") REFERENCES "public"."pact_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_intents" ADD CONSTRAINT "relay_intents_attestation_digest_attestations_digest_fk" FOREIGN KEY ("attestation_digest") REFERENCES "public"."attestations"("digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relay_intents_attestation_uq" ON "relay_intents" USING btree ("attestation_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "relay_intents_sender_unresolved_uq" ON "relay_intents" USING btree ("chain_id","relay_address") WHERE "relay_intents"."state" in ('PREPARING','SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN');--> statement-breakpoint
CREATE UNIQUE INDEX "relay_intents_sender_nonce_uq" ON "relay_intents" USING btree ("chain_id","relay_address","nonce") WHERE "relay_intents"."nonce" is not null and "relay_intents"."state" in ('PREPARING','SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN');--> statement-breakpoint
CREATE INDEX "relay_intents_state_idx" ON "relay_intents" USING btree ("state","updated_at");
--> statement-breakpoint
CREATE FUNCTION pact_guard_relay_intent_identity() RETURNS trigger AS $$
BEGIN
	IF OLD.serialized_transaction IS NOT NULL AND ROW(
		NEW.chain_id, NEW.relay_address, NEW.pact_evaluator, NEW.commerce_contract,
		NEW.nonce, NEW.calldata, NEW.serialized_transaction, NEW.expected_tx_hash,
		NEW.transaction_type, NEW.gas_limit, NEW.gas_price, NEW.max_fee_per_gas,
		NEW.max_priority_fee_per_gas, NEW.pre_dispatch_block_number,
		NEW.pre_dispatch_block_hash
	) IS DISTINCT FROM ROW(
		OLD.chain_id, OLD.relay_address, OLD.pact_evaluator, OLD.commerce_contract,
		OLD.nonce, OLD.calldata, OLD.serialized_transaction, OLD.expected_tx_hash,
		OLD.transaction_type, OLD.gas_limit, OLD.gas_price, OLD.max_fee_per_gas,
		OLD.max_priority_fee_per_gas, OLD.pre_dispatch_block_number,
		OLD.pre_dispatch_block_hash
	) THEN
		RAISE EXCEPTION 'signed relay transaction identity is immutable'
			USING ERRCODE = '23514', CONSTRAINT = 'relay_intents_signed_identity_immutable';
	END IF;
	IF OLD.broadcast_attempt_count = 1 AND NEW.broadcast_attempt_count <> 1 THEN
		RAISE EXCEPTION 'relay broadcast ownership is irreversible'
			USING ERRCODE = '23514', CONSTRAINT = 'relay_intents_broadcast_irreversible';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER relay_intents_identity_guard
BEFORE UPDATE ON relay_intents
FOR EACH ROW EXECUTE FUNCTION pact_guard_relay_intent_identity();
