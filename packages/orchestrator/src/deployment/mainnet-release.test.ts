import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { assertDeploymentManifest } from "./manifest.js";
import {
  APPROVED_CONTROL_PATHS,
  APPROVED_MANIFEST_VALIDATOR_BLOB,
  TESTNET_EVIDENCE_CHECKPOINT,
  assertMainnetGate,
  type ReleaseGitInspection,
} from "./mainnet-release.js";

const candidate = "c".repeat(40);
const manifestJson = readFileSync("deployments/arc-testnet.json", "utf8");
const manifest = assertDeploymentManifest(JSON.parse(manifestJson) as unknown);
const evaluatorHash = manifest.pactEvaluator.artifactBytecodeHash;

function inspection(
  overrides: Partial<{
    clean: boolean;
    ancestor: boolean;
    checkpointAncestor: boolean;
    changed: readonly string[];
    releaseManifest: string;
    locked: boolean;
    validatorBlob: string;
  }> = {},
): ReleaseGitInspection {
  const values = {
    clean: true,
    ancestor: true,
    checkpointAncestor: true,
    changed: APPROVED_CONTROL_PATHS,
    releaseManifest: manifestJson,
    locked: true,
    validatorBlob: APPROVED_MANIFEST_VALIDATOR_BLOB,
    ...overrides,
  };
  return {
    head: () => candidate,
    isClean: () => values.clean,
    isAncestor: (ancestor) =>
      ancestor === TESTNET_EVIDENCE_CHECKPOINT
        ? values.checkpointAncestor
        : values.ancestor,
    changedPaths: () => values.changed,
    pathEquals: () => values.locked,
    fileAt: () => values.releaseManifest,
    blobAt: () => values.validatorBlob,
  };
}

function check(
  value = manifest,
  gitInspection: ReleaseGitInspection = inspection(),
  artifact: Hex = evaluatorHash,
): void {
  assertMainnetGate(candidate, artifact, value, {
    inspection: gitInspection,
  });
}

function mutableManifest(): Record<string, unknown> {
  return structuredClone(manifest) as unknown as Record<string, unknown>;
}

describe("Mainnet release gate", () => {
  it("blocks a missing Testnet PASS", () => {
    const value = mutableManifest();
    delete value.testnetGate;
    expect(() => check(value as never)).toThrow(
      "MAINNET_BLOCKED_TESTNET_GATE_MISSING",
    );
  });

  it("blocks the exact runtime commit when PASS evidence is absent", () => {
    const value = mutableManifest();
    delete value.testnetGate;
    expect(() =>
      assertMainnetGate(
        manifest.testnetGate!.e2eRuntimeCommit,
        evaluatorHash,
        value as never,
        {
          inspection: inspection(),
        },
      ),
    ).toThrow("MAINNET_BLOCKED_TESTNET_GATE_MISSING");
  });

  it("passes a descendant with only approved provenance/control differences", () => {
    expect(() => check()).not.toThrow();
  });

  it.each([
    ["contract source", "packages/contracts/src/PactEvaluator.sol"],
    ["GitHub verifier", "packages/verifier/src/github/verify.ts"],
    ["condition hashing", "packages/protocol/src/condition.ts"],
    ["evidence hashing", "packages/protocol/src/evidence.ts"],
    ["attestation signing", "packages/verifier/src/signer/index.ts"],
    ["Phase 4A reconciliation", "packages/orchestrator/src/reconcile.ts"],
    ["Phase 4B relay/broadcast", "packages/orchestrator/src/relay/chain.ts"],
    ["accounting", "packages/orchestrator/src/deployment/safety.ts"],
    ["runtime dependency lock", "package-lock.json"],
  ])("blocks %s drift", (_label, path) => {
    expect(() =>
      check(
        manifest,
        inspection({ changed: [...APPROVED_CONTROL_PATHS, path] }),
      ),
    ).toThrow("MAINNET_BLOCKED_RUNTIME_DRIFT");
  });

  it("blocks a non-descendant release", () => {
    expect(() => check(manifest, inspection({ ancestor: false }))).toThrow(
      "MAINNET_BLOCKED_NON_DESCENDANT_RELEASE",
    );
  });

  it("blocks a dirty candidate worktree", () => {
    expect(() => check(manifest, inspection({ clean: false }))).toThrow(
      "MAINNET_BLOCKED_DIRTY_WORKTREE",
    );
  });

  it("blocks a tampered Testnet manifest even when structurally valid", () => {
    const value = mutableManifest();
    const gate = value.testnetGate as Record<string, unknown>;
    gate.conditionHash = `0x${"0".repeat(64)}`;
    const tampered = assertDeploymentManifest(value);
    expect(() => check(tampered)).toThrow(
      "MAINNET_BLOCKED_TESTNET_MANIFEST_INTEGRITY",
    );
  });

  it("blocks changes to runtime-locked control files", () => {
    expect(() => check(manifest, inspection({ locked: false }))).toThrow(
      "MAINNET_BLOCKED_RUNTIME_DRIFT",
    );
  });

  it("blocks unreviewed manifest-validator changes", () => {
    expect(() =>
      check(manifest, inspection({ validatorBlob: "0".repeat(40) })),
    ).toThrow("MAINNET_BLOCKED_CONTROL_DRIFT");
  });

  it("uses the freshly certified E2E runtime as the immutable runtime root", () => {
    const value = mutableManifest();
    (value.testnetGate as Record<string, unknown>).e2eRuntimeCommit =
      "d".repeat(40);
    expect(() =>
      check(
        assertDeploymentManifest(value),
        inspection({ ancestor: false, releaseManifest: JSON.stringify(value) }),
      ),
    ).toThrow("MAINNET_BLOCKED_NON_DESCENDANT_RELEASE");
  });
});
