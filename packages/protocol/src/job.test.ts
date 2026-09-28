import { describe, expect, it } from "vitest";

import {
  encodePactJobIdentity,
  hashPactJobIdentity,
  normalizePactJobIdentity,
  type CanonicalPactJobIdentity,
} from "./job.js";

const example = {
  chainId: 5042n,
  commerceContract: "0x1111111111111111111111111111111111111111",
  jobId: 81n,
} as const;

describe("Pact ERC-8183 job identity", () => {
  it("normalizes and deterministically commits chain, deployment, and job", () => {
    const identity = normalizePactJobIdentity(example);

    expect(identity).toEqual({
      schemaVersion: 1,
      ...example,
    });
    expect(hashPactJobIdentity(identity)).toBe(
      hashPactJobIdentity(normalizePactJobIdentity(example)),
    );
  });

  it("separates identical job IDs across chains and commerce deployments", () => {
    const identity = normalizePactJobIdentity(example);
    const anotherChain = normalizePactJobIdentity({
      ...example,
      chainId: 5042002n,
    });
    const anotherDeployment = normalizePactJobIdentity({
      ...example,
      commerceContract: "0x2222222222222222222222222222222222222222",
    });

    expect(hashPactJobIdentity(identity)).not.toBe(
      hashPactJobIdentity(anotherChain),
    );
    expect(hashPactJobIdentity(identity)).not.toBe(
      hashPactJobIdentity(anotherDeployment),
    );
  });

  it("matches the published version-1 job identity vector", () => {
    expect(hashPactJobIdentity(normalizePactJobIdentity(example))).toBe(
      "0x3fc68520644941b41fc25c71eda15a50c082760a14b99b90f39864ded7975ea7",
    );
  });

  it.each([
    { ...example, chainId: 0n },
    { ...example, jobId: 0n },
    {
      ...example,
      commerceContract: "0x0000000000000000000000000000000000000000",
    },
    { ...example, commerceContract: "not-an-address" },
  ])("rejects an invalid identity", (input) => {
    expect(() => normalizePactJobIdentity(input)).toThrow();
  });

  it("rejects a forged non-canonical typed object", () => {
    const forged = {
      ...normalizePactJobIdentity(example),
      schemaVersion: 2,
    } as unknown as CanonicalPactJobIdentity;

    expect(() => encodePactJobIdentity(forged)).toThrow(
      "job identity must already be in canonical version-1 form",
    );
  });
});
