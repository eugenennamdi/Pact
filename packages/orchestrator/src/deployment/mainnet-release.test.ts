import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  assertDeploymentManifest,
  testnetGateResultHash,
  type DeploymentManifest,
} from "./manifest.js";
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

function recertifyTestnetGate(value: Record<string, unknown>): void {
  const gate = value.testnetGate as Record<string, unknown>;
  delete gate.resultHash;
  gate.resultHash = testnetGateResultHash(gate as never);
}

describe("Mainnet release gate", () => {
  it("allows only the exact reviewed release-control files", () => {
    expect(APPROVED_CONTROL_PATHS).toEqual([
      "packages/orchestrator/src/deployment/manifest.test.ts",
      "packages/orchestrator/src/deployment/manifest.ts",
      "packages/orchestrator/src/deployment/mainnet-release.ts",
      "packages/orchestrator/src/deployment/mainnet-release.test.ts",
    ]);
  });

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
    recertifyTestnetGate(value);
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
    recertifyTestnetGate(value);
    expect(() =>
      check(
        assertDeploymentManifest(value),
        inspection({ ancestor: false, releaseManifest: JSON.stringify(value) }),
      ),
    ).toThrow("MAINNET_BLOCKED_NON_DESCENDANT_RELEASE");
  });
});

describe("Real Git inspection suite", () => {
  it("proves real git blob of manifest.ts equals APPROVED_MANIFEST_VALIDATOR_BLOB", () => {
    const realBlob = execFileSync(
      "git",
      ["hash-object", "packages/orchestrator/src/deployment/manifest.ts"],
      { encoding: "utf8" },
    ).trim();
    expect(realBlob).toBe(APPROVED_MANIFEST_VALIDATOR_BLOB);
  });

  describe("isolated repository tests", () => {
    let tempDir: string;
    let baseCommit: string;
    let validTestnetManifest: DeploymentManifest;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "pact-mainnet-release-test-"));
      execFileSync("git", ["clone", "--shared", process.cwd(), tempDir], {
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "Test Runner"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.email", "test@pact.local"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();

      const manifestObj = structuredClone(manifest) as unknown as Record<
        string,
        unknown
      >;
      const gate = manifestObj.testnetGate as Record<string, unknown>;
      gate.e2eRuntimeCommit = baseCommit;
      recertifyTestnetGate(manifestObj);
      validTestnetManifest = assertDeploymentManifest(manifestObj);

      writeFileSync(
        join(tempDir, "deployments/arc-testnet.json"),
        JSON.stringify(validTestnetManifest, null, 2),
      );
      execFileSync("git", ["add", "deployments/arc-testnet.json"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "commit",
          "-m",
          "chore: update testnet manifest gate for candidate",
          "--no-gpg-sign",
        ],
        { cwd: tempDir, stdio: "ignore" },
      );
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("passes valid newly certified Testnet runtime with narrowly reviewed Mainnet release", () => {
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      expect(() =>
        assertMainnetGate(head, evaluatorHash, validTestnetManifest, {
          repository: tempDir,
        }),
      ).not.toThrow();
    });

    it("blocks a dirty worktree in real Git inspection", () => {
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      writeFileSync(join(tempDir, "dirty-file.txt"), "untracked content");
      expect(() =>
        assertMainnetGate(head, evaluatorHash, validTestnetManifest, {
          repository: tempDir,
        }),
      ).toThrow("MAINNET_BLOCKED_DIRTY_WORKTREE");
    });

    it("blocks a changed manifest validator in candidate commit in real Git inspection", () => {
      writeFileSync(
        join(tempDir, "packages/orchestrator/src/deployment/manifest.ts"),
        "// modified manifest validator",
      );
      execFileSync(
        "git",
        ["commit", "-am", "modify validator", "--no-gpg-sign"],
        { cwd: tempDir, stdio: "ignore" },
      );
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      expect(() =>
        assertMainnetGate(head, evaluatorHash, validTestnetManifest, {
          repository: tempDir,
        }),
      ).toThrow(
        "MAINNET_BLOCKED_CONTROL_DRIFT:packages/orchestrator/src/deployment/manifest.ts",
      );
    });

    it("blocks an unreviewed/stale manifest validator blob in real Git inspection", () => {
      // Create a commit where manifest.ts differs, and use it as both e2eRuntimeCommit and head
      writeFileSync(
        join(tempDir, "packages/orchestrator/src/deployment/manifest.ts"),
        "// different validator blob",
      );
      execFileSync(
        "git",
        ["commit", "-am", "commit different validator", "--no-gpg-sign"],
        { cwd: tempDir, stdio: "ignore" },
      );
      const staleCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();

      const manifestObj = structuredClone(manifest) as unknown as Record<
        string,
        unknown
      >;
      const gate = manifestObj.testnetGate as Record<string, unknown>;
      gate.e2eRuntimeCommit = staleCommit;
      recertifyTestnetGate(manifestObj);
      const staleManifest = assertDeploymentManifest(manifestObj);

      writeFileSync(
        join(tempDir, "deployments/arc-testnet.json"),
        JSON.stringify(staleManifest, null, 2),
      );
      execFileSync("git", ["add", "deployments/arc-testnet.json"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["commit", "-m", "update testnet manifest", "--no-gpg-sign"],
        { cwd: tempDir, stdio: "ignore" },
      );
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();

      // Between staleCommit and head, manifest.ts did not change, but its blob does not match APPROVED_MANIFEST_VALIDATOR_BLOB
      expect(() =>
        assertMainnetGate(head, evaluatorHash, staleManifest, {
          repository: tempDir,
        }),
      ).toThrow(
        "MAINNET_BLOCKED_CONTROL_DRIFT:packages/orchestrator/src/deployment/manifest.ts",
      );
    });

    it("blocks unapproved runtime drift in real Git inspection", () => {
      writeFileSync(
        join(tempDir, "packages/orchestrator/src/relay/chain.ts"),
        "// unapproved runtime drift",
      );
      execFileSync(
        "git",
        ["commit", "-am", "unapproved runtime drift", "--no-gpg-sign"],
        { cwd: tempDir, stdio: "ignore" },
      );
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      expect(() =>
        assertMainnetGate(head, evaluatorHash, validTestnetManifest, {
          repository: tempDir,
        }),
      ).toThrow("MAINNET_BLOCKED_RUNTIME_DRIFT");
    });

    it("blocks non-descendant runtime in real Git inspection", () => {
      // Create a disconnected orphan commit with commit-tree
      const orphanTree = execFileSync("git", ["write-tree"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      const orphanCommit = execFileSync(
        "git",
        ["commit-tree", orphanTree, "-m", "orphan commit"],
        { cwd: tempDir, encoding: "utf8" },
      ).trim();

      const manifestObj = structuredClone(manifest) as unknown as Record<
        string,
        unknown
      >;
      const gate = manifestObj.testnetGate as Record<string, unknown>;
      gate.e2eRuntimeCommit = orphanCommit;
      recertifyTestnetGate(manifestObj);
      const nonDescendantManifest = assertDeploymentManifest(manifestObj);

      writeFileSync(
        join(tempDir, "deployments/arc-testnet.json"),
        JSON.stringify(nonDescendantManifest, null, 2),
      );
      execFileSync("git", ["add", "deployments/arc-testnet.json"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "commit",
          "-m",
          "update manifest to orphan e2eRuntimeCommit",
          "--no-gpg-sign",
        ],
        { cwd: tempDir, stdio: "ignore" },
      );
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();

      expect(() =>
        assertMainnetGate(head, evaluatorHash, nonDescendantManifest, {
          repository: tempDir,
        }),
      ).toThrow("MAINNET_BLOCKED_NON_DESCENDANT_RELEASE");
    });
  });
});
