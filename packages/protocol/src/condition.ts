import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";

export const CONDITION_SCHEMA_VERSION = 1 as const;
export const GITHUB_PROVIDER = "github" as const;
export const PR_MERGED_EVENT = "PR_MERGED" as const;

const CONDITION_TYPE =
  "GithubPrMergedCondition(uint8 schemaVersion,string provider,string repository,uint64 pullRequest,string baseBranch,string event)";
const CONDITION_TYPE_HASH = keccak256(stringToHex(CONDITION_TYPE));
const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const REPOSITORY_PATTERN = /^[a-z0-9._-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

export interface GithubPrMergedConditionInput {
  readonly provider: typeof GITHUB_PROVIDER;
  readonly repository: string;
  readonly pullRequest: number;
  readonly baseBranch: string;
  readonly event: typeof PR_MERGED_EVENT;
}

export interface CanonicalGithubPrMergedCondition extends GithubPrMergedConditionInput {
  readonly schemaVersion: typeof CONDITION_SCHEMA_VERSION;
}

function assertNoSurroundingWhitespace(label: string, value: string): void {
  if (value.trim() !== value) {
    throw new Error(`${label} must not contain surrounding whitespace`);
  }
}

function normalizeRepository(repository: string): string {
  assertNoSurroundingWhitespace("repository", repository);

  const parts = repository.split("/");
  if (parts.length !== 2) {
    throw new Error(
      "repository must use the owner/name form with exactly one slash",
    );
  }

  const [rawOwner, rawName] = parts;
  if (rawOwner === undefined || rawName === undefined) {
    throw new Error("repository must contain both owner and name");
  }

  const owner = rawOwner.toLowerCase();
  const name = rawName.toLowerCase();

  if (
    !OWNER_PATTERN.test(owner) ||
    owner.includes("--") ||
    new TextEncoder().encode(owner).length > 39
  ) {
    throw new Error(
      "repository owner is outside Pact's supported GitHub subset",
    );
  }

  if (
    !REPOSITORY_PATTERN.test(name) ||
    !/[a-z0-9]/.test(name) ||
    name === "." ||
    name === ".." ||
    new TextEncoder().encode(name).length > 100
  ) {
    throw new Error(
      "repository name is outside Pact's supported GitHub subset",
    );
  }

  return `${owner}/${name}`;
}

function validateBaseBranch(baseBranch: string): string {
  assertNoSurroundingWhitespace("baseBranch", baseBranch);

  if (!BRANCH_PATTERN.test(baseBranch)) {
    throw new Error(
      "baseBranch is outside Pact's supported ASCII Git ref subset",
    );
  }

  if (
    baseBranch.includes("//") ||
    baseBranch.includes("..") ||
    baseBranch.includes("@{") ||
    baseBranch.endsWith("/") ||
    baseBranch.endsWith(".") ||
    baseBranch
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error("baseBranch is not a canonical supported Git ref");
  }

  return baseBranch;
}

export function normalizeGithubPrMergedCondition(
  input: GithubPrMergedConditionInput,
): CanonicalGithubPrMergedCondition {
  if (input.provider !== GITHUB_PROVIDER) {
    throw new Error(`provider must be exactly ${GITHUB_PROVIDER}`);
  }

  if (input.event !== PR_MERGED_EVENT) {
    throw new Error(`event must be exactly ${PR_MERGED_EVENT}`);
  }

  if (!Number.isSafeInteger(input.pullRequest) || input.pullRequest <= 0) {
    throw new Error("pullRequest must be a positive safe integer");
  }

  return Object.freeze({
    schemaVersion: CONDITION_SCHEMA_VERSION,
    provider: GITHUB_PROVIDER,
    repository: normalizeRepository(input.repository),
    pullRequest: input.pullRequest,
    baseBranch: validateBaseBranch(input.baseBranch),
    event: PR_MERGED_EVENT,
  });
}

export function encodeGithubPrMergedCondition(
  condition: CanonicalGithubPrMergedCondition,
): Hex {
  const canonical = normalizeGithubPrMergedCondition({
    provider: condition.provider,
    repository: condition.repository,
    pullRequest: condition.pullRequest,
    baseBranch: condition.baseBranch,
    event: condition.event,
  });

  if (
    condition.schemaVersion !== CONDITION_SCHEMA_VERSION ||
    condition.repository !== canonical.repository ||
    condition.baseBranch !== canonical.baseBranch
  ) {
    throw new Error("condition must already be in canonical version-1 form");
  }

  return encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typeHash, uint8 schemaVersion, bytes32 providerHash, bytes32 repositoryHash, uint64 pullRequest, bytes32 baseBranchHash, bytes32 eventHash",
    ),
    [
      CONDITION_TYPE_HASH,
      canonical.schemaVersion,
      keccak256(stringToHex(canonical.provider)),
      keccak256(stringToHex(canonical.repository)),
      BigInt(canonical.pullRequest),
      keccak256(stringToHex(canonical.baseBranch)),
      keccak256(stringToHex(canonical.event)),
    ],
  );
}

export function hashGithubPrMergedCondition(
  condition: CanonicalGithubPrMergedCondition,
): Hex {
  return keccak256(encodeGithubPrMergedCondition(condition));
}
