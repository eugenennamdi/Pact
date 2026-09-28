import { describe, expect, it } from "vitest";
import { recoverAddress } from "viem";

import { verifyGitHubPrMerged } from "../github/verify.js";
import type { GitHubPullRequestClient } from "../github/client.js";
import type { VerifiedGitHubCompletion } from "../internal/verified.js";
import {
  createPactCompletionSigner,
  createPactCompletionSignerFromEnv,
} from "./index.js";

const privateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d";

async function verifiedCompletion(): Promise<VerifiedGitHubCompletion> {
  const client: GitHubPullRequestClient = {
    getPullRequest: async () => ({
      ok: true,
      value: {
        number: 81,
        state: "closed",
        merged: true,
        mergedAt: "2027-01-15T08:00:00Z",
        mergeCommitSha: "0123456789abcdef0123456789abcdef01234567",
        baseRepository: "pact-protocol/demo",
        baseBranch: "main",
        privateRepository: false,
      },
    }),
    checkPullRequestMerged: async () => ({ ok: true, value: { merged: true } }),
  };
  const result = await verifyGitHubPrMerged({
    condition: {
      provider: "github",
      repository: "pact-protocol/demo",
      pullRequest: 81,
      baseBranch: "main",
      event: "PR_MERGED",
    },
    completionDeadline: 1_800_000_120n,
    observedAt: 1_800_000_060n,
    client,
  });
  if (result.status !== "SATISFIED") throw new Error("fixture did not verify");
  return result;
}

const context = {
  chainId: 5042n,
  verifyingContract: "0x2222222222222222222222222222222222222222",
  commerceContract: "0x1111111111111111111111111111111111111111",
  jobId: 81n,
  erc8183ExpiredAt: 1_800_001_000n,
} as const;

describe("Pact completion signer boundary", () => {
  it("derives the attestation from verified facts and produces a recoverable signature", async () => {
    const completion = await verifiedCompletion();
    const signer = createPactCompletionSigner({ privateKey });
    const signed = await signer.signVerifiedCompletion(completion, context);
    expect(signed.attestation).toEqual({
      commerceContract: context.commerceContract,
      jobId: context.jobId,
      conditionHash: completion.conditionHash,
      evidenceHash: completion.evidenceHash,
      satisfiedAt: completion.satisfiedAt,
      verifiedAt: completion.observedAt,
      validUntil: completion.observedAt + 300n,
    });
    await expect(
      recoverAddress({ hash: signed.digest, signature: signed.signature }),
    ).resolves.toBe(signer.address);
    expect(
      JSON.stringify(signed, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(privateKey.slice(2));
  });

  it("caps validUntil strictly before the ERC-8183 expiry", async () => {
    const completion = await verifiedCompletion();
    const signer = createPactCompletionSigner({
      privateKey,
      attestationTtlSeconds: 900n,
    });
    const signed = await signer.signVerifiedCompletion(completion, {
      ...context,
      erc8183ExpiredAt: completion.observedAt + 100n,
    });
    expect(signed.attestation.validUntil).toBe(completion.observedAt + 99n);
  });

  it("does not expose a generic fact or validity override", async () => {
    const completion = await verifiedCompletion();
    const signer = createPactCompletionSigner({ privateKey });
    expect(Object.keys(signer)).toEqual([
      "address",
      "attestationTtlSeconds",
      "signVerifiedCompletion",
    ]);
    await expect(
      signer.signVerifiedCompletion(
        {
          ...completion,
          evidenceHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        context,
      ),
    ).rejects.toThrow("not produced by the Pact GitHub verifier");
  });

  it("rejects structurally forged non-success values at runtime", async () => {
    const signer = createPactCompletionSigner({ privateKey });
    const forged = {
      status: "NOT_SATISFIED",
    } as unknown as VerifiedGitHubCompletion;
    await expect(
      signer.signVerifiedCompletion(forged, context),
    ).rejects.toThrow("not produced by the Pact GitHub verifier");
  });

  it.each(["", "0x01", `0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`])(
    "rejects malformed or invalid private key %s",
    (badKey) => {
      expect(() => createPactCompletionSigner({ privateKey: badKey })).toThrow(
        "PACT_VERIFIER_PRIVATE_KEY is invalid",
      );
    },
  );

  it("requires bounded TTLs and a nonempty expiry window", async () => {
    expect(() =>
      createPactCompletionSigner({ privateKey, attestationTtlSeconds: 29n }),
    ).toThrow();
    expect(() =>
      createPactCompletionSigner({ privateKey, attestationTtlSeconds: 901n }),
    ).toThrow();
    const completion = await verifiedCompletion();
    await expect(
      createPactCompletionSigner({ privateKey }).signVerifiedCompletion(
        completion,
        { ...context, erc8183ExpiredAt: completion.observedAt },
      ),
    ).rejects.toThrow("later than verification time");
  });

  it("loads only explicitly named server-side environment values", () => {
    const signer = createPactCompletionSignerFromEnv({
      PACT_VERIFIER_PRIVATE_KEY: privateKey,
      PACT_ATTESTATION_TTL_SECONDS: "60",
    });
    expect(signer.attestationTtlSeconds).toBe(60n);
  });
});
