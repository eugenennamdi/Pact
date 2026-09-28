import { describe, expect, it } from "vitest";

import {
  encodeGithubPrMergedCondition,
  hashGithubPrMergedCondition,
  normalizeGithubPrMergedCondition,
  type CanonicalGithubPrMergedCondition,
} from "./condition.js";

const example = {
  provider: "github",
  repository: "Pact-Protocol/Demo",
  pullRequest: 81,
  baseBranch: "main",
  event: "PR_MERGED",
} as const;

describe("GitHub PR_MERGED condition commitment", () => {
  it("normalizes GitHub's case-insensitive repository identity", () => {
    expect(normalizeGithubPrMergedCondition(example)).toEqual({
      schemaVersion: 1,
      provider: "github",
      repository: "pact-protocol/demo",
      pullRequest: 81,
      baseBranch: "main",
      event: "PR_MERGED",
    });
  });

  it("is deterministic and keeps the case-sensitive base branch semantic", () => {
    const canonical = normalizeGithubPrMergedCondition(example);
    const sameLogicalCondition = normalizeGithubPrMergedCondition({
      ...example,
      repository: "pact-protocol/demo",
    });
    const differentBranch = normalizeGithubPrMergedCondition({
      ...example,
      baseBranch: "Main",
    });

    expect(hashGithubPrMergedCondition(canonical)).toBe(
      hashGithubPrMergedCondition(sameLogicalCondition),
    );
    expect(hashGithubPrMergedCondition(canonical)).not.toBe(
      hashGithubPrMergedCondition(differentBranch),
    );
  });

  it("matches the published version-1 flagship vector", () => {
    const canonical = normalizeGithubPrMergedCondition(example);

    expect(hashGithubPrMergedCondition(canonical)).toBe(
      "0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4",
    );
  });

  it("fails closed if a caller forges a non-canonical typed object", () => {
    const forged = {
      ...normalizeGithubPrMergedCondition(example),
      repository: "Pact-Protocol/Demo",
    } as CanonicalGithubPrMergedCondition;

    expect(() => encodeGithubPrMergedCondition(forged)).toThrow(
      "condition must already be in canonical version-1 form",
    );
  });

  it.each([
    { ...example, repository: " owner/repo" },
    { ...example, repository: "owner/repo/extra" },
    { ...example, pullRequest: 0 },
    { ...example, pullRequest: 1.5 },
    { ...example, baseBranch: "main..candidate" },
    { ...example, baseBranch: "release//v1" },
  ])("rejects non-canonical or unsupported input", (input) => {
    expect(() => normalizeGithubPrMergedCondition(input)).toThrow();
  });
});
