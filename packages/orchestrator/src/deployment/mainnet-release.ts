import { execFileSync } from "node:child_process";
import type { Hex } from "viem";
import type { DeploymentManifest } from "./manifest.js";

export const MAINNET_RELEASE_GATE_VERSION = 1 as const;
export const TESTNET_DEPLOYMENT_GIT_COMMIT =
  "5e9214f996ef48bc465ca2ee6a4f8e30d782a362" as const;
export const TESTNET_E2E_RUNTIME_COMMIT =
  "f8c7c6240f0655e86cdd156bcd4f8792ab672549" as const;
export const TESTNET_EVIDENCE_CHECKPOINT =
  "52c53e5d641b47666fdf4488142c1eba95500014" as const;
export const PINNED_ERC8183_SOURCE_COMMIT =
  "142e669c1fd318486a4628395b629f033654dd06" as const;

const TESTNET_MANIFEST_PATH = "deployments/arc-testnet.json";
const MANIFEST_VALIDATOR_PATH =
  "packages/orchestrator/src/deployment/manifest.ts";

// Filled from `git hash-object` after the validator/re-export isolation is
// complete. Keeping this separate from manifest.ts avoids a self-reference.
export const APPROVED_MANIFEST_VALIDATOR_BLOB =
  "d32a26d5c3310755ee87fb2f87e3e0554d9ac523" as const;

/**
 * Versioned, fail-closed roots for every production input that can affect the
 * Mainnet contracts or live flow. A changed path beneath these roots is blocked
 * unless it is named in APPROVED_CONTROL_PATHS below.
 */
export const MAINNET_CRITICAL_RUNTIME_ROOTS = Object.freeze([
  "apps",
  "packages",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "tsconfig.json",
] as const);

/** Exact control/evidence exceptions reviewed after the successful Testnet run. */
export const APPROVED_CONTROL_PATHS = Object.freeze([
  "packages/orchestrator/src/deployment/manifest.ts",
  "packages/orchestrator/src/deployment/manifest.test.ts",
  "packages/orchestrator/src/deployment/mainnet-release.ts",
  "packages/orchestrator/src/deployment/mainnet-release.test.ts",
  "packages/orchestrator/src/deployment/operator.ts",
] as const);

/** Evidence-checkpoint files that must remain byte-for-byte unchanged. */
export const EVIDENCE_LOCKED_PATHS = Object.freeze([
  ".env.example",
  "deployments/arc-testnet.json",
  "deployments/manifest.schema.json",
  "docs/PHASE5A_ARC_TESTNET_REHEARSAL.md",
  "packages/orchestrator/src/deployment/operator.ts",
] as const);

export interface ReleaseGitInspection {
  readonly head: () => string;
  readonly isClean: () => boolean;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly changedPaths: (
    from: string,
    to: string,
    roots: readonly string[],
  ) => readonly string[];
  readonly pathEquals: (from: string, to: string, path: string) => boolean;
  readonly fileAt: (commit: string, path: string) => string;
  readonly blobAt: (commit: string, path: string) => string;
}

function git(repository: string): ReleaseGitInspection {
  const run = (args: readonly string[]): string =>
    execFileSync("git", [...args], { cwd: repository, encoding: "utf8" });
  const success = (args: readonly string[]): boolean => {
    try {
      execFileSync("git", [...args], { cwd: repository, stdio: "ignore" });
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error.status === 1 || error.status === 128)
      )
        return false;
      throw error;
    }
  };
  return {
    head: () => run(["rev-parse", "HEAD"]).trim(),
    isClean: () =>
      run(["status", "--porcelain", "--untracked-files=all"]) === "",
    isAncestor: (ancestor, descendant) =>
      success(["merge-base", "--is-ancestor", ancestor, descendant]),
    changedPaths: (from, to, roots) =>
      run([
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        from,
        to,
        "--",
        ...roots,
      ])
        .split("\n")
        .filter((path) => path.length > 0),
    pathEquals: (from, to, path) =>
      success(["diff", "--quiet", from, to, "--", path]),
    fileAt: (commit, path) => run(["show", `${commit}:${path}`]),
    blobAt: (commit, path) => run(["rev-parse", `${commit}:${path}`]).trim(),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertMainnetGate(
  mainnetGitCommit: string,
  evaluatorCodeHash: Hex,
  testnet: DeploymentManifest,
  options: {
    readonly repository?: string;
    /** Test-only deterministic Git boundary. Production callers never set it. */
    readonly inspection?: ReleaseGitInspection;
  } = {},
): void {
  if (
    testnet.network !== "arc-testnet" ||
    testnet.testnetGate?.status !== "PASS"
  )
    throw new Error("MAINNET_BLOCKED_TESTNET_GATE_MISSING");

  const gate = testnet.testnetGate;
  if (
    testnet.gitCommit !== TESTNET_DEPLOYMENT_GIT_COMMIT ||
    gate.deploymentGitCommit !== TESTNET_DEPLOYMENT_GIT_COMMIT ||
    gate.e2eRuntimeCommit !== TESTNET_E2E_RUNTIME_COMMIT
  )
    throw new Error("MAINNET_BLOCKED_TESTNET_PROVENANCE_DRIFT");
  if (
    gate.erc8183SourceCommit !== PINNED_ERC8183_SOURCE_COMMIT ||
    gate.evaluatorCodeHash.toLowerCase() !== evaluatorCodeHash.toLowerCase()
  )
    throw new Error("MAINNET_BLOCKED_ARTIFACT_DRIFT");

  const inspection =
    options.inspection ?? git(options.repository ?? process.cwd());
  if (inspection.head() !== mainnetGitCommit)
    throw new Error("MAINNET_BLOCKED_RELEASE_NOT_HEAD");
  if (!inspection.isClean()) throw new Error("MAINNET_BLOCKED_DIRTY_WORKTREE");
  if (!inspection.isAncestor(TESTNET_E2E_RUNTIME_COMMIT, mainnetGitCommit))
    throw new Error("MAINNET_BLOCKED_NON_DESCENDANT_RELEASE");
  if (!inspection.isAncestor(TESTNET_EVIDENCE_CHECKPOINT, mainnetGitCommit))
    throw new Error("MAINNET_BLOCKED_EVIDENCE_CHECKPOINT_MISSING");

  let checkpointManifest: unknown;
  try {
    checkpointManifest = JSON.parse(
      inspection.fileAt(TESTNET_EVIDENCE_CHECKPOINT, TESTNET_MANIFEST_PATH),
    ) as unknown;
  } catch {
    throw new Error("MAINNET_BLOCKED_TESTNET_MANIFEST_INTEGRITY");
  }
  if (canonical(testnet) !== canonical(checkpointManifest))
    throw new Error("MAINNET_BLOCKED_TESTNET_MANIFEST_INTEGRITY");

  const approved = new Set<string>(APPROVED_CONTROL_PATHS);
  const unexpected = inspection
    .changedPaths(
      TESTNET_E2E_RUNTIME_COMMIT,
      mainnetGitCommit,
      MAINNET_CRITICAL_RUNTIME_ROOTS,
    )
    .filter((path) => !approved.has(path));
  if (unexpected.length > 0)
    throw new Error(
      `MAINNET_BLOCKED_RUNTIME_DRIFT:${unexpected.sort().join(",")}`,
    );

  for (const path of EVIDENCE_LOCKED_PATHS) {
    if (
      !inspection.pathEquals(
        TESTNET_EVIDENCE_CHECKPOINT,
        mainnetGitCommit,
        path,
      )
    )
      throw new Error(`MAINNET_BLOCKED_CONTROL_DRIFT:${path}`);
  }
  if (
    inspection.blobAt(mainnetGitCommit, MANIFEST_VALIDATOR_PATH) !==
    APPROVED_MANIFEST_VALIDATOR_BLOB
  )
    throw new Error(`MAINNET_BLOCKED_CONTROL_DRIFT:${MANIFEST_VALIDATOR_PATH}`);
}
