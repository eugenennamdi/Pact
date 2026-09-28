import { describe, expect, it } from "vitest";

import {
  GITHUB_PR_MERGED_EVIDENCE_TYPE,
  GITHUB_PR_MERGED_EVIDENCE_TYPEHASH,
  encodePactGitHubPrMergedEvidenceV1,
  hashPactGitHubPrMergedEvidenceV1,
  normalizePactGitHubPrMergedEvidenceV1,
} from "./evidence.js";

const vectorInput = {
  conditionHash:
    "0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4",
  repository: "Pact-Protocol/Demo",
  pullRequest: 81,
  baseBranch: "main",
  mergeCommitSha: "0123456789ABCDEF0123456789ABCDEF01234567",
  mergedAt: 1_800_000_000,
  observedAt: 1_800_000_060,
} as const;

describe("Pact GitHub PR_MERGED evidence V1", () => {
  it("pins the exact type declaration and canonical normalization", () => {
    expect(GITHUB_PR_MERGED_EVIDENCE_TYPE).toBe(
      "PactGitHubPrMergedEvidence(uint8 schemaVersion,bytes32 conditionHash,string repository,uint64 pullRequest,string baseBranch,bytes20 mergeCommitSha,uint64 mergedAt,uint64 observedAt)",
    );
    expect(normalizePactGitHubPrMergedEvidenceV1(vectorInput)).toEqual({
      schemaVersion: 1,
      conditionHash: vectorInput.conditionHash,
      repository: "pact-protocol/demo",
      pullRequest: 81n,
      baseBranch: "main",
      mergeCommitSha: "0x0123456789abcdef0123456789abcdef01234567",
      mergedAt: 1_800_000_000n,
      observedAt: 1_800_000_060n,
    });
  });

  it("matches the published evidence hash vector", () => {
    const evidence = normalizePactGitHubPrMergedEvidenceV1(vectorInput);
    expect(GITHUB_PR_MERGED_EVIDENCE_TYPEHASH).toBe(
      "0x6aa35fd3cfcfea53c0af3bff550d9bd8ec717510b7db9525eafc0ee9fff9a261",
    );
    expect(encodePactGitHubPrMergedEvidenceV1(evidence)).toBe(
      "0x6aa35fd3cfcfea53c0af3bff550d9bd8ec717510b7db9525eafc0ee9fff9a26100000000000000000000000000000000000000000000000000000000000000013da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4070d4775c0b837a639d2c1b3c0022c2441fbc21e631d73b001cacb07135f63f00000000000000000000000000000000000000000000000000000000000000051b8e2054f8a912367e38a22ce773328ff8aabf8082c4120bad9ef085e1dbf29a70123456789abcdef0123456789abcdef01234567000000000000000000000000000000000000000000000000000000000000000000000000000000006b49d200000000000000000000000000000000000000000000000000000000006b49d23c",
    );
    expect(hashPactGitHubPrMergedEvidenceV1(evidence)).toBe(
      "0x0a1ed8785c5d5548b1d6472aa40a10b7c297485d8f244dc216fced19544a4eea",
    );
  });

  it("is deterministic and binds every factual field", () => {
    const evidence = normalizePactGitHubPrMergedEvidenceV1(vectorInput);
    const baseline = hashPactGitHubPrMergedEvidenceV1(evidence);
    expect(hashPactGitHubPrMergedEvidenceV1(evidence)).toBe(baseline);

    const mutations = [
      { ...vectorInput, conditionHash: `0x${"11".repeat(32)}` },
      { ...vectorInput, repository: "pact-protocol/other" },
      { ...vectorInput, pullRequest: 82 },
      { ...vectorInput, baseBranch: "Main" },
      {
        ...vectorInput,
        mergeCommitSha: "1123456789abcdef0123456789abcdef01234567",
      },
      { ...vectorInput, mergedAt: 1_799_999_999 },
      { ...vectorInput, observedAt: 1_800_000_061 },
    ];
    for (const mutation of mutations) {
      expect(
        hashPactGitHubPrMergedEvidenceV1(
          normalizePactGitHubPrMergedEvidenceV1(mutation),
        ),
      ).not.toBe(baseline);
    }
  });

  it.each([
    { ...vectorInput, conditionHash: `0x${"AA".repeat(32)}` },
    { ...vectorInput, repository: " pact-protocol/demo" },
    { ...vectorInput, pullRequest: 0 },
    { ...vectorInput, baseBranch: "main..candidate" },
    { ...vectorInput, mergeCommitSha: "abc" },
    { ...vectorInput, mergedAt: 0 },
    { ...vectorInput, observedAt: 1_799_999_999 },
  ])("rejects malformed or noncanonical evidence input", (input) => {
    expect(() => normalizePactGitHubPrMergedEvidenceV1(input)).toThrow();
  });

  it("rejects a forged noncanonical typed object", () => {
    const forged = {
      ...normalizePactGitHubPrMergedEvidenceV1(vectorInput),
      repository: "Pact-Protocol/Demo",
    };
    expect(() => encodePactGitHubPrMergedEvidenceV1(forged)).toThrow(
      "evidence must already be in canonical version-1 form",
    );
  });
});
