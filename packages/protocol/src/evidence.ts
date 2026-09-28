import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";

import {
  GITHUB_PROVIDER,
  PR_MERGED_EVENT,
  normalizeGithubPrMergedCondition,
} from "./condition.js";
import type { Hex32 } from "./attestation.js";

export const GITHUB_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const GITHUB_PR_MERGED_EVIDENCE_TYPE =
  "PactGitHubPrMergedEvidence(uint8 schemaVersion,bytes32 conditionHash,string repository,uint64 pullRequest,string baseBranch,bytes20 mergeCommitSha,uint64 mergedAt,uint64 observedAt)" as const;
export const GITHUB_PR_MERGED_EVIDENCE_TYPEHASH = keccak256(
  stringToHex(GITHUB_PR_MERGED_EVIDENCE_TYPE),
);

const UINT64_MAX = (1n << 64n) - 1n;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/;

export type GitCommitSha = `0x${string}`;

export interface PactGitHubPrMergedEvidenceV1Input {
  readonly conditionHash: string;
  readonly repository: string;
  readonly pullRequest: number | bigint;
  readonly baseBranch: string;
  readonly mergeCommitSha: string;
  readonly mergedAt: number | bigint;
  readonly observedAt: number | bigint;
}

export interface PactGitHubPrMergedEvidenceV1 {
  readonly schemaVersion: typeof GITHUB_EVIDENCE_SCHEMA_VERSION;
  readonly conditionHash: Hex32;
  readonly repository: string;
  readonly pullRequest: bigint;
  readonly baseBranch: string;
  readonly mergeCommitSha: GitCommitSha;
  readonly mergedAt: bigint;
  readonly observedAt: bigint;
}

function normalizeUint64(label: string, value: number | bigint): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or bigint`);
  }

  const normalized = BigInt(value);
  if (normalized <= 0n || normalized > UINT64_MAX) {
    throw new Error(`${label} must be a positive uint64`);
  }
  return normalized;
}

export function normalizeGitCommitSha(value: string): GitCommitSha {
  if (value.trim() !== value || !GIT_SHA_PATTERN.test(value)) {
    throw new Error("mergeCommitSha must be exactly one full 40-hex Git SHA");
  }

  const unprefixed = value.startsWith("0x") ? value.slice(2) : value;
  return `0x${unprefixed.toLowerCase()}`;
}

export function normalizePactGitHubPrMergedEvidenceV1(
  input: PactGitHubPrMergedEvidenceV1Input,
): PactGitHubPrMergedEvidenceV1 {
  if (!BYTES32_PATTERN.test(input.conditionHash)) {
    throw new Error(
      "conditionHash must be one canonical lowercase bytes32 value",
    );
  }

  const pullRequest = normalizeUint64("pullRequest", input.pullRequest);
  if (pullRequest > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("pullRequest is outside the canonical condition range");
  }

  const conditionShape = normalizeGithubPrMergedCondition({
    provider: GITHUB_PROVIDER,
    repository: input.repository,
    pullRequest: Number(pullRequest),
    baseBranch: input.baseBranch,
    event: PR_MERGED_EVENT,
  });
  const mergedAt = normalizeUint64("mergedAt", input.mergedAt);
  const observedAt = normalizeUint64("observedAt", input.observedAt);
  if (mergedAt > observedAt) {
    throw new Error("mergedAt must not be later than observedAt");
  }

  return Object.freeze({
    schemaVersion: GITHUB_EVIDENCE_SCHEMA_VERSION,
    conditionHash: input.conditionHash as Hex32,
    repository: conditionShape.repository,
    pullRequest,
    baseBranch: conditionShape.baseBranch,
    mergeCommitSha: normalizeGitCommitSha(input.mergeCommitSha),
    mergedAt,
    observedAt,
  });
}

export function encodePactGitHubPrMergedEvidenceV1(
  evidence: PactGitHubPrMergedEvidenceV1,
): Hex {
  const canonical = normalizePactGitHubPrMergedEvidenceV1(evidence);
  if (
    evidence.schemaVersion !== GITHUB_EVIDENCE_SCHEMA_VERSION ||
    evidence.repository !== canonical.repository ||
    evidence.baseBranch !== canonical.baseBranch ||
    evidence.mergeCommitSha !== canonical.mergeCommitSha
  ) {
    throw new Error("evidence must already be in canonical version-1 form");
  }

  return encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typeHash, uint8 schemaVersion, bytes32 conditionHash, bytes32 repositoryHash, uint64 pullRequest, bytes32 baseBranchHash, bytes20 mergeCommitSha, uint64 mergedAt, uint64 observedAt",
    ),
    [
      GITHUB_PR_MERGED_EVIDENCE_TYPEHASH,
      canonical.schemaVersion,
      canonical.conditionHash,
      keccak256(stringToHex(canonical.repository)),
      canonical.pullRequest,
      keccak256(stringToHex(canonical.baseBranch)),
      canonical.mergeCommitSha,
      canonical.mergedAt,
      canonical.observedAt,
    ],
  );
}

export function hashPactGitHubPrMergedEvidenceV1(
  evidence: PactGitHubPrMergedEvidenceV1,
): Hex32 {
  return keccak256(encodePactGitHubPrMergedEvidenceV1(evidence));
}
