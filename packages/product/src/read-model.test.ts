import {
  hashGithubPrMergedCondition,
  normalizeGithubPrMergedCondition,
  type Hex32,
} from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { projectPublicStatus, toPublicPactDto } from "./read-model";
import type { PactDraft, ProductProjectionInput, WalletAction } from "./types";

const condition = normalizeGithubPrMergedCondition({
  provider: "github",
  repository: "example/repo",
  pullRequest: 7,
  baseBranch: "main",
  event: "PR_MERGED",
});
const CLIENT = getAddress("0x1111111111111111111111111111111111111111");
const PROVIDER = getAddress("0x2222222222222222222222222222222222222222");
const HASH = `0x${"ab".repeat(32)}` as Hex32;
const NOW = new Date("2026-10-03T12:00:00.000Z");

const baseDraft: PactDraft = {
  id: "11111111-1111-4111-8111-111111111111",
  publicSlug: `pact_${"a".repeat(32)}`,
  creatingWallet: CLIENT,
  providerAddress: PROVIDER,
  githubRepository: condition.repository,
  githubPullRequest: condition.pullRequest,
  baseBranch: condition.baseBranch,
  event: condition.event,
  amountBaseUnits: 100_000n,
  network: "arc-testnet",
  chainId: 5_042_002n,
  condition,
  conditionHash: hashGithubPrMergedCondition(condition) as Hex32,
  completionPolicyVersion: 1,
  completionOffsetSeconds: 7_200,
  expiryPolicyVersion: 1,
  expiryOffsetSeconds: 21_600,
  idempotencyKey: "hidden-idempotency",
  canonicalRequestHash: HASH,
  linkedPactRecordId: null,
  lifecycle: "ACTION_REQUIRED",
  createdAt: NOW,
  updatedAt: NOW,
};

const fundedAction: WalletAction = {
  id: "22222222-2222-4222-8222-222222222222",
  draftId: baseDraft.id,
  pactRecordId: null,
  action: "FUND",
  requiredSigner: CLIENT,
  chainId: 5_042_002n,
  expectedTarget: CLIENT,
  value: 0n,
  calldataHash: HASH,
  preparationVersion: 1,
  transactionHash: HASH,
  confirmationStatus: "CONFIRMED",
  idempotencyKey: "hidden-action-key",
  createdAt: NOW,
  updatedAt: NOW,
};

function input(
  overrides: Partial<ProductProjectionInput> = {},
): ProductProjectionInput {
  return {
    draft: baseDraft,
    walletActions: [],
    operationState: null,
    relayState: null,
    chainJobStatus: null,
    chainExpiredAt: null,
    now: 1_780_000_000n,
    jobId: null,
    jobKey: null,
    completionDeadline: null,
    evidence: null,
    settlement: null,
    ...overrides,
  };
}

describe("public product status projection", () => {
  it.each([
    ["DRAFT", input({ draft: { ...baseDraft, lifecycle: "DRAFT" } })],
    ["ACTION_REQUIRED", input()],
    ["FUNDED", input({ walletActions: [fundedAction] })],
    ["AWAITING_PROVIDER", input({ chainJobStatus: 1 })],
    ["AWAITING_CONDITION", input({ chainJobStatus: 2 })],
    ["VERIFYING", input({ operationState: "VERIFYING_GITHUB" })],
    ["SETTLING", input({ relayState: "BROADCAST_UNKNOWN" })],
    ["COMPLETED", input({ chainJobStatus: 3 })],
    ["EXPIRED", input({ chainJobStatus: 5 })],
    [
      "NEEDS_ATTENTION",
      input({
        draft: {
          ...baseDraft,
          linkedPactRecordId: "33333333-3333-4333-8333-333333333333",
        },
      }),
    ],
  ] as const)("projects %s", (expected, projection) => {
    expect(projectPublicStatus(projection)).toBe(expected);
  });

  it("fails closed when product inputs conflict", () => {
    expect(
      projectPublicStatus(input({ chainJobStatus: 2, relayState: "REVERTED" })),
    ).toBe("NEEDS_ATTENTION");
  });

  it("does not override an authoritative Open chain snapshot with a wallet projection", () => {
    expect(
      projectPublicStatus(
        input({ chainJobStatus: 0, walletActions: [fundedAction] }),
      ),
    ).toBe("NEEDS_ATTENTION");
  });

  it("returns only sanitized public fields", () => {
    const serialized = JSON.stringify(toPublicPactDto(input()));
    for (const forbidden of [
      "idempotency",
      "nonce",
      "session",
      "token",
      "serializedTransaction",
      "database",
      "internal",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("serializes canonical evidence and settlement bigint values", () => {
    const dto = toPublicPactDto(
      input({
        evidence: {
          evidenceHash: HASH,
          mergeCommitSha: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          mergedAt: 1_700_000_000n,
          observedAt: 1_700_000_001n,
        },
        settlement: {
          transactionHash: HASH,
          state: "SETTLED",
          blockNumber: 123n,
        },
      }),
    );
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(dto.evidence?.mergedAt).toBe("1700000000");
    expect(dto.settlement?.blockNumber).toBe("123");
  });
});
