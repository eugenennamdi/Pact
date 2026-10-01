import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { assertDeploymentCodeSnapshot } from "./integrity.js";
import {
  ARC_USDC_ADDRESS,
  ERC8183_NORMATIVE_REVISION,
  ERC8183_SOURCE_COMMIT,
  assertDeploymentManifest,
  mainnetGateResultHash,
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

function validMainnetManifest(): Record<string, unknown> {
  const manifest = validManifest();
  delete manifest.testnetGate;
  manifest.network = "arc-mainnet";
  manifest.chainId = "5042";
  const erc8183 = object(manifest, "erc8183");
  const evaluator = object(manifest, "pactEvaluator");
  const deploymentTransactions = object(manifest, "deploymentTransactions");
  const evidenceHash = hash("b");
  const receiptBlockHash = hash("e");
  const gate = {
    schemaVersion: 1 as const,
    status: "PASS" as const,
    chainId: "5042" as const,
    mainnetReleaseCommit: manifest.gitCommit as string,
    erc8183SourceCommit: ERC8183_SOURCE_COMMIT,
    completedAt: "2026-09-30T01:00:00.000Z",
    contracts: {
      implementation: erc8183.implementation as `0x${string}`,
      proxy: erc8183.proxy as `0x${string}`,
      pactEvaluator: evaluator.address as `0x${string}`,
    },
    runtimeCodeHashes: {
      erc8183Implementation: erc8183.implementationCodeHash as Hex,
      erc8183Proxy: erc8183.proxyCodeHash as Hex,
      pactEvaluator: evaluator.codeHash as Hex,
    },
    roles: {
      operator: manifest.deployer as `0x${string}`,
      treasury: erc8183.treasury as `0x${string}`,
      provider: "0x9999999999999999999999999999999999999999" as const,
      verifier: evaluator.verifier as `0x${string}`,
      relay: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
    },
    deploymentTransactions: {
      implementation: deploymentTransactions.implementation as Hex,
      proxy: deploymentTransactions.proxy as Hex,
      allowUsdc: deploymentTransactions.allowUsdc as Hex,
      evaluator: deploymentTransactions.evaluator as Hex,
    },
    jobId: "1",
    github: {
      repository: "pact-protocol/demo",
      pullRequest: 3,
      baseBranch: "main",
      mergeCommitSha: `0x${"1".repeat(40)}` as Hex,
      mergedAt: "2026-09-30T00:30:00.000Z",
    },
    conditionHash: hash("a"),
    evidenceHash,
    attestationDigest: hash("c"),
    settlement: {
      transactionHash: hash("d"),
      receiptBlockNumber: "789",
      receiptBlockHash,
      pactCompletionAccepted: {
        blockNumber: "789",
        blockHash: receiptBlockHash,
        logIndex: 2,
      },
      jobCompleted: {
        blockNumber: "789",
        blockHash: receiptBlockHash,
        logIndex: 3,
      },
    },
    broadcastAttemptCount: 1 as const,
    economics: {
      budget: "100000",
      grossFunding: "100000",
      grossProviderPayout: "100000",
      treasuryApplicationPayout: "0" as const,
      evaluatorApplicationPayout: "0" as const,
      settledAmount: "0",
      completionReason: evidenceHash,
    },
    finalState: { jobStatus: 3 as const, bindingAccepted: true as const },
  };
  manifest.mainnetGate = {
    ...gate,
    resultHash: mainnetGateResultHash(gate as never),
  };
  return manifest;
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

  it("accepts deployed Mainnet without a gate and a complete Mainnet PASS", () => {
    const preE2E = validMainnetManifest();
    delete preE2E.mainnetGate;
    expect(assertDeploymentManifest(preE2E).mainnetGate).toBeUndefined();
    expect(
      assertDeploymentManifest(validMainnetManifest()).mainnetGate?.status,
    ).toBe("PASS");
  });

  it.each([
    [
      "missing settlement evidence",
      (m: Record<string, unknown>) =>
        delete object(m, "mainnetGate").settlement,
    ],
    [
      "wrong broadcast count",
      (m: Record<string, unknown>) =>
        (object(m, "mainnetGate").broadcastAttemptCount = 2),
    ],
    [
      "payout mismatch",
      (m: Record<string, unknown>) =>
        (object(object(m, "mainnetGate"), "economics").grossProviderPayout =
          "99999"),
    ],
    [
      "completion reason mismatch",
      (m: Record<string, unknown>) =>
        (object(object(m, "mainnetGate"), "economics").completionReason =
          hash("f")),
    ],
    [
      "runtime identity drift",
      (m: Record<string, unknown>) =>
        (object(object(m, "mainnetGate"), "runtimeCodeHashes").pactEvaluator =
          hash("f")),
    ],
    [
      "event coordinate drift",
      (m: Record<string, unknown>) =>
        (object(
          object(object(m, "mainnetGate"), "settlement"),
          "jobCompleted",
        ).blockNumber = "790"),
    ],
  ])("rejects Mainnet PASS with %s", (_label, mutate) => {
    const manifest = validMainnetManifest();
    mutate(manifest);
    expect(() => assertDeploymentManifest(manifest)).toThrow(
      /invalid deployment manifest/,
    );
  });

  it("keeps Testnet and Mainnet gates independent", () => {
    const testnet = validManifest();
    testnet.mainnetGate = object(validMainnetManifest(), "mainnetGate");
    expect(() => assertDeploymentManifest(testnet)).toThrow(
      "invalid deployment manifest: mainnetGate network",
    );
  });

  it("binds the Mainnet result hash to every factual field", () => {
    const manifest = validMainnetManifest();
    const parsed = assertDeploymentManifest(manifest);
    expect(() => assertDeploymentManifest(parsed)).not.toThrow();
    object(object(manifest, "mainnetGate"), "github").pullRequest = 4;
    expect(() => assertDeploymentManifest(manifest)).toThrow(
      /mainnetGate\.resultHash/,
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
