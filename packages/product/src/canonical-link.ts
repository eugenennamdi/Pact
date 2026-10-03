import {
  PostgresPactRepository,
  type PactDatabase,
  type PactRecord,
  type PactRepository,
} from "@pact/database";
import {
  hashPactJobIdentity,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import type { Address } from "viem";
import type { PactDraft } from "./types";

export interface CanonicalPactRegistration {
  readonly pactRecordId: string;
  readonly jobKey: Hex32;
}

export interface CanonicalPactRegistrar {
  register(input: {
    readonly draft: PactDraft;
    readonly commerce: Address;
    readonly evaluator: Address;
    readonly jobId: bigint;
    readonly completionDeadline: bigint;
  }): Promise<CanonicalPactRegistration>;
}

function sameRecord(left: PactRecord, right: PactRecord): boolean {
  return (
    left.id === right.id &&
    left.chainId === right.chainId &&
    left.commerceContract === right.commerceContract &&
    left.pactEvaluator === right.pactEvaluator &&
    left.jobId === right.jobId &&
    left.jobKey === right.jobKey &&
    left.conditionHash === right.conditionHash &&
    left.completionDeadline === right.completionDeadline &&
    JSON.stringify(left.condition) === JSON.stringify(right.condition)
  );
}

export class ProductCanonicalPactRegistrar implements CanonicalPactRegistrar {
  readonly #repository: PactRepository;

  constructor(databaseOrRepository: PactDatabase | PactRepository) {
    this.#repository =
      "createPact" in databaseOrRepository
        ? databaseOrRepository
        : new PostgresPactRepository(databaseOrRepository);
  }

  async register(input: {
    readonly draft: PactDraft;
    readonly commerce: Address;
    readonly evaluator: Address;
    readonly jobId: bigint;
    readonly completionDeadline: bigint;
  }): Promise<CanonicalPactRegistration> {
    const jobKey = hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: input.draft.chainId,
        commerceContract: input.commerce,
        jobId: input.jobId,
      }),
    ) as Hex32;
    const expected: PactRecord = Object.freeze({
      id: input.draft.id,
      chainId: input.draft.chainId,
      commerceContract: input.commerce,
      pactEvaluator: input.evaluator,
      jobId: input.jobId,
      jobKey,
      condition: input.draft.condition,
      conditionHash: input.draft.conditionHash,
      completionDeadline: input.completionDeadline,
    });
    const existing = await this.#repository.getPact(expected.id);
    if (existing !== undefined) {
      if (!sameRecord(existing, expected))
        throw new Error("CANONICAL_PACT_LINK_CONFLICT");
      return { pactRecordId: existing.id, jobKey: existing.jobKey };
    }
    try {
      const created = await this.#repository.createPact(expected);
      if (!sameRecord(created, expected))
        throw new Error("CANONICAL_PACT_LINK_INTEGRITY_MISMATCH");
      return { pactRecordId: created.id, jobKey: created.jobKey };
    } catch (error) {
      const raced = await this.#repository.getPact(expected.id);
      if (raced === undefined || !sameRecord(raced, expected)) throw error;
      return { pactRecordId: raced.id, jobKey: raced.jobKey };
    }
  }
}
