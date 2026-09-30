import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { assertDeploymentCodeSnapshot } from "./integrity.js";
import {
  ARC_USDC_ADDRESS,
  ERC8183_NORMATIVE_REVISION,
  ERC8183_SOURCE_COMMIT,
  assertDeploymentManifest,
  assertMainnetGate,
} from "./manifest.js";

const hash = (byte: string): Hex => `0x${byte.repeat(64)}` as Hex;

function validManifest(): Record<string, unknown> {
  const proxy = "0x1111111111111111111111111111111111111111";
  const gitCommit = "a".repeat(40);
  return {
    schemaVersion: 1,
    status: "DEPLOYED",
    network: "arc-testnet",
    chainId: "5042002",
    deploymentTimestamp: "2026-09-29T00:00:00.000Z",
    deploymentBlock: "123",
    deployer: "0x2222222222222222222222222222222222222222",
    gitCommit,
    usdc: { address: ARC_USDC_ADDRESS, decimals: 6 },
    erc8183: {
      classification: "PACT_MANAGED_PINNED",
      proxy,
      implementation: "0x3333333333333333333333333333333333333333",
      proxyCodeHash: keccak256("0x6001"),
      implementationCodeHash: keccak256("0x6002"),
      sourceCommit: ERC8183_SOURCE_COMMIT,
      normativeRevision: ERC8183_NORMATIVE_REVISION,
      defaultAdmin: "0x4444444444444444444444444444444444444444",
      admin: "0x4444444444444444444444444444444444444444",
      treasury: "0x5555555555555555555555555555555555555555",
      platformFeeBps: "0",
      evaluatorFeeBps: "0",
      paused: false,
      paymentTokenAllowed: true,
      hookPolicy: "NONE",
    },
    pactEvaluator: {
      address: "0x6666666666666666666666666666666666666666",
      codeHash: keccak256("0x6003"),
      artifactBytecodeHash: hash("9"),
      commerceContract: proxy,
      verifier: "0x7777777777777777777777777777777777777777",
      admin: "0x8888888888888888888888888888888888888888",
      domainVersion: "2",
    },
    toolchain: {
      solidity: "0.8.28",
      evmTarget: "cancun",
      foundryVersion: "1.4.4",
      openZeppelinVersion: "5.6.1",
      viemVersion: "2.56.9",
    },
    deploymentTransactions: {
      implementation: hash("4"),
      proxy: hash("5"),
      allowUsdc: hash("6"),
      evaluator: hash("7"),
    },
    sourceVerification: {
      erc8183Implementation: "PENDING",
      erc8183Proxy: "PENDING",
      pactEvaluator: "PENDING",
    },
    testnetGate: {
      status: "PASS",
      deploymentGitCommit: gitCommit,
      e2eRuntimeCommit: "b".repeat(40),
      erc8183SourceCommit: ERC8183_SOURCE_COMMIT,
      evaluatorCodeHash: hash("9"),
      completedAt: "2026-09-29T01:00:00.000Z",
      resultHash: hash("8"),
      jobId: "2",
      github: {
        repository: "pact-protocol/demo",
        pullRequest: 2,
        baseBranch: "main",
        mergeCommitSha: `0x${"1".repeat(40)}`,
      },
      conditionHash: hash("a"),
      evidenceHash: hash("b"),
      attestationDigest: hash("c"),
      settlementTransactionHash: hash("d"),
      event: { blockNumber: "456", logIndex: 0 },
      runtimeCodeHashes: {
        erc8183Proxy: keccak256("0x6001"),
        erc8183Implementation: keccak256("0x6002"),
        pactEvaluator: keccak256("0x6003"),
      },
    },
  };
}

function object(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return value[key] as Record<string, unknown>;
}

describe("deployment manifest", () => {
  it("accepts a complete pinned Arc Testnet manifest", () => {
    expect(assertDeploymentManifest(validManifest()).chainId).toBe("5042002");
  });

  it.each([
    ["wrong chain", (m: Record<string, unknown>) => (m.chainId = "5042")],
    [
      "wrong USDC",
      (m: Record<string, unknown>) =>
        (object(m, "usdc").address = object(m, "erc8183").proxy),
    ],
    [
      "wrong target",
      (m: Record<string, unknown>) =>
        (object(m, "pactEvaluator").commerceContract = m.deployer),
    ],
    [
      "unpinned source",
      (m: Record<string, unknown>) =>
        (object(m, "erc8183").sourceCommit = "b".repeat(40)),
    ],
    [
      "nonzero fee",
      (m: Record<string, unknown>) =>
        (object(m, "erc8183").platformFeeBps = "1"),
    ],
  ])("rejects %s", (_label, mutate) => {
    const manifest = validManifest();
    mutate(manifest);
    expect(() => assertDeploymentManifest(manifest)).toThrow(
      /invalid deployment manifest/,
    );
  });

  it("fails the mainnet gate on any release identity drift", () => {
    const manifest = assertDeploymentManifest(validManifest());
    expect(() =>
      assertMainnetGate("b".repeat(40), hash("9"), manifest),
    ).not.toThrow();
    expect(() =>
      assertMainnetGate("a".repeat(40), hash("8"), manifest),
    ).toThrow("MAINNET_BLOCKED_ARTIFACT_DRIFT");
  });

  it("records deployment and corrected E2E runtime provenance separately", () => {
    const manifest = assertDeploymentManifest(validManifest());
    expect(manifest.gitCommit).toBe("a".repeat(40));
    expect(manifest.testnetGate?.deploymentGitCommit).toBe("a".repeat(40));
    expect(manifest.testnetGate?.e2eRuntimeCommit).toBe("b".repeat(40));
  });

  it("rejects Testnet gate runtime-code provenance drift", () => {
    const manifest = validManifest();
    object(object(manifest, "testnetGate"), "runtimeCodeHashes").pactEvaluator =
      hash("f");
    expect(() => assertDeploymentManifest(manifest)).toThrow(
      /testnetGate\.runtimeCodeHashes\.pactEvaluator/,
    );
  });

  it("fails closed on runtime bytecode or EIP-1967 implementation drift", () => {
    const manifest = assertDeploymentManifest(validManifest());
    const snapshot = {
      proxyCode: "0x6001" as Hex,
      implementationCode: "0x6002" as Hex,
      evaluatorCode: "0x6003" as Hex,
      usdcCode: "0x6004" as Hex,
      implementationSlot:
        `0x${"00".repeat(12)}3333333333333333333333333333333333333333` as Hex,
    };
    expect(() =>
      assertDeploymentCodeSnapshot(manifest, snapshot),
    ).not.toThrow();
    expect(() =>
      assertDeploymentCodeSnapshot(manifest, {
        ...snapshot,
        evaluatorCode: "0x6004",
      }),
    ).toThrow("EVALUATOR_CODE_HASH_MISMATCH");
    expect(() =>
      assertDeploymentCodeSnapshot(manifest, {
        ...snapshot,
        implementationSlot: `0x${"00".repeat(12)}4444444444444444444444444444444444444444`,
      }),
    ).toThrow("IMPLEMENTATION_SLOT_MISMATCH");
  });
});
