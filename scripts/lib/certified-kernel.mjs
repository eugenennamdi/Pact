import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { keccak256 } from "viem";

export const EXPECTED_PROVENANCE = Object.freeze({
  certifiedBaselineCommit: "3d6e6b34c42166b5c3c72dc51abd664de5966af8",
  testnetCertifiedRuntimeCommit: "fa20328df6643b0d85f6c2b6074d79dd0e5de54c",
  mainnetExecutionReleaseCommit: "b5792c756b04fae543b1d3d92a337858ea9f529d",
  erc8183SourceCommit: "142e669c1fd318486a4628395b629f033654dd06",
});

export const EXPECTED_CONTRACT_IDENTITIES = Object.freeze({
  erc8183Implementation:
    "0x3c6f713207465de296ba93015dd8caae14d5a6e3726e210585e613ff890754d2",
  erc1967Proxy:
    "0x1eac464d69c06a2b77f155c6a2da62aadb7fa460cd80ed1e139fd285698b20c3",
  pactEvaluator:
    "0xd965f1c6b1574e32ca258e300558eb37bfef0ec253c0a02a4ebf7d05a546b487",
});

export const REQUIRED_PROTECTED_PATHS = Object.freeze([
  "tsconfig.base.json",
  "packages/protocol/package.json",
  "packages/protocol/tsconfig.json",
  "packages/protocol/tsconfig.build.json",
  "packages/protocol/src/index.ts",
  "packages/protocol/src/condition.ts",
  "packages/protocol/src/condition.test.ts",
  "packages/protocol/src/evidence.ts",
  "packages/protocol/src/evidence.test.ts",
  "packages/protocol/src/attestation.ts",
  "packages/protocol/src/attestation.test.ts",
  "packages/protocol/src/job.ts",
  "packages/protocol/src/job.test.ts",
  "packages/contracts/src/**",
  "packages/contracts/lib/erc8183-base-contracts/**",
  "packages/contracts/lib/openzeppelin-contracts*/**",
  "packages/contracts/SOLIDITY_DEPENDENCIES.lock",
  "packages/contracts/FOUNDRY_VERSION",
  "packages/contracts/foundry.toml",
  "packages/contracts/test/**",
  "packages/verifier/package.json",
  "packages/verifier/tsconfig.json",
  "packages/verifier/src/index.ts",
  "packages/verifier/src/github/index.ts",
  "packages/verifier/src/github/client.ts",
  "packages/verifier/src/github/client.test.ts",
  "packages/verifier/src/github/verify.ts",
  "packages/verifier/src/github/verify.test.ts",
  "packages/verifier/src/internal/verified.ts",
  "packages/verifier/src/signer/index.ts",
  "packages/verifier/src/signer/index.test.ts",
  "packages/orchestrator/package.json",
  "packages/orchestrator/tsconfig.json",
  "packages/orchestrator/src/index.ts",
  "packages/orchestrator/src/chain.ts",
  "packages/orchestrator/src/config.ts",
  "packages/orchestrator/src/reconcile.ts",
  "packages/orchestrator/src/reconcile.test.ts",
  "packages/orchestrator/src/service.ts",
  "packages/orchestrator/src/service.test.ts",
  "packages/orchestrator/src/state.ts",
  "packages/orchestrator/src/state.test.ts",
  "packages/orchestrator/src/webhook.ts",
  "packages/orchestrator/src/webhook.test.ts",
  "packages/orchestrator/src/relay/**",
  "packages/orchestrator/src/deployment/**",
  "packages/orchestrator/src/recovery.ts",
  "packages/orchestrator/src/recovery.test.ts",
  "packages/orchestrator/src/recovery.local-e2e.test.ts",
  "packages/database/package.json",
  "packages/database/tsconfig.json",
  "packages/database/drizzle.config.ts",
  "packages/database/src/index.ts",
  "packages/database/src/schema.ts",
  "packages/database/src/schema.test.ts",
  "packages/database/src/types.ts",
  "packages/database/src/repository.ts",
  "packages/database/src/relay-repository.ts",
  "packages/database/src/client.ts",
  "packages/database/src/live-test.ts",
  "packages/database/drizzle/0000_overrated_baron_zemo.sql",
  "packages/database/drizzle/0001_sour_preak.sql",
  "packages/database/drizzle/meta/**",
  "deployments/manifest.schema.json",
  "deployments/arc-testnet.json",
  "deployments/arc-mainnet.json",
  "apps/web/next.config.ts",
  "apps/web/tsconfig.json",
  "apps/web/server/runtime.ts",
  "apps/web/server/http.ts",
  "apps/web/server/http.test.ts",
  "apps/web/app/api/github/webhook/route.ts",
  "apps/web/app/api/operations/process/route.ts",
  "apps/web/app/api/operations/recover/route.ts",
  "apps/web/app/api/pacts/[id]/verify/route.ts",
  "apps/web/app/api/relay/process/route.ts",
  "apps/web/app/api/relay/reconcile/route.ts",
]);

const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "protocolVersion",
  ...Object.keys(EXPECTED_PROVENANCE),
  "protectedPaths",
  "contractArtifacts",
  "dependencyProtection",
]);

const DEPENDENCY_MAINTENANCE_CLASSIFICATIONS = Object.freeze(
  new Set(["BUILD_TOOLING_ONLY", "DEPLOYED_APPLICATION_RUNTIME"]),
);

const SOURCE_MAINTENANCE_CLASSIFICATIONS = Object.freeze(
  new Set(["SECURITY_SENSITIVE_RECOVERY_KERNEL"]),
);

export class KernelVerificationError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "KernelVerificationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = []) {
  throw new KernelVerificationError(code, message, details);
}

function strictKeys(value, expected, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("MALFORMED_MANIFEST", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    fail("MALFORMED_MANIFEST", `${label} has unknown or missing keys`, [
      `expected=${wanted.join(",")}`,
      `actual=${actual.join(",")}`,
    ]);
}

function exact(value, expected, label) {
  if (value !== expected)
    fail("MANIFEST_IDENTITY_MISMATCH", `${label} must equal ${expected}`);
}

function fullCommit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value))
    fail("MALFORMED_MANIFEST", `${label} must be a lowercase full commit`);
}

function hash32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value))
    fail("MALFORMED_MANIFEST", `${label} must be a lowercase bytes32 hash`);
}

function dependencyFingerprint(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value))
    fail("MALFORMED_MANIFEST", `${label} must be a sha256 fingerprint`);
}

function validateDependencyMaintenance(protection) {
  const maintenance = protection.maintenance;
  if (!Array.isArray(maintenance))
    fail("MALFORMED_MANIFEST", "dependency maintenance must be an array");
  let expectedFrom = protection.baselineFingerprint;
  for (const [index, event] of maintenance.entries()) {
    const label = `dependencyProtection.maintenance[${index}]`;
    strictKeys(
      event,
      [
        "schemaVersion",
        "type",
        "advisory",
        "changes",
        "fromFingerprint",
        "toFingerprint",
        "classification",
      ],
      label,
    );
    if (event.schemaVersion !== 1)
      fail("MALFORMED_MANIFEST", `${label}.schemaVersion must equal 1`);
    if (event.type !== "SECURITY_PATCH")
      fail("MALFORMED_MANIFEST", `${label}.type is not reviewed`);
    if (
      typeof event.advisory !== "string" ||
      !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(event.advisory)
    )
      fail("MALFORMED_MANIFEST", `${label}.advisory is malformed`);
    if (!DEPENDENCY_MAINTENANCE_CLASSIFICATIONS.has(event.classification))
      fail("MALFORMED_MANIFEST", `${label}.classification is not reviewed`);
    dependencyFingerprint(event.fromFingerprint, `${label}.fromFingerprint`);
    dependencyFingerprint(event.toFingerprint, `${label}.toFingerprint`);
    if (event.fromFingerprint === event.toFingerprint)
      fail(
        "MALFORMED_MANIFEST",
        `${label} must change the dependency fingerprint`,
      );
    if (event.fromFingerprint !== expectedFrom)
      fail(
        "DEPENDENCY_MAINTENANCE_CHAIN_BROKEN",
        `${label}.fromFingerprint is not contiguous`,
      );
    if (!Array.isArray(event.changes) || event.changes.length === 0)
      fail("MALFORMED_MANIFEST", `${label}.changes must not be empty`);
    const packages = new Set();
    let previousPackage = "";
    for (const [changeIndex, change] of event.changes.entries()) {
      const changeLabel = `${label}.changes[${changeIndex}]`;
      strictKeys(change, ["package", "from", "to"], changeLabel);
      if (
        typeof change.package !== "string" ||
        !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(change.package)
      )
        fail("MALFORMED_MANIFEST", `${changeLabel}.package is malformed`);
      if (
        typeof change.from !== "string" ||
        typeof change.to !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(change.from) ||
        !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(change.to)
      )
        fail("MALFORMED_MANIFEST", `${changeLabel} versions are malformed`);
      if (change.from === change.to)
        fail("MALFORMED_MANIFEST", `${changeLabel} versions must differ`);
      if (packages.has(change.package))
        fail(
          "MALFORMED_MANIFEST",
          `${label} contains duplicate package changes`,
        );
      if (
        previousPackage !== "" &&
        previousPackage.localeCompare(change.package) >= 0
      )
        fail(
          "MALFORMED_MANIFEST",
          `${label}.changes must use ascending package order`,
        );
      packages.add(change.package);
      previousPackage = change.package;
    }
    expectedFrom = event.toFingerprint;
  }
  if (expectedFrom !== protection.fingerprint)
    fail(
      "DEPENDENCY_MAINTENANCE_CHAIN_BROKEN",
      "maintenance chain does not terminate at the effective fingerprint",
    );
}

function validateSourceMaintenance(manifest) {
  if (manifest.sourceMaintenance === undefined) return;
  const maintenance = manifest.sourceMaintenance;
  if (!Array.isArray(maintenance))
    fail("MALFORMED_MANIFEST", "sourceMaintenance must be an array");
  for (const [index, event] of maintenance.entries()) {
    const label = `sourceMaintenance[${index}]`;
    strictKeys(
      event,
      [
        "schemaVersion",
        "type",
        "review",
        "baselineCommit",
        "targetBaselineCommit",
        "classification",
        "changes",
      ],
      label,
    );
    if (event.schemaVersion !== 1)
      fail("MALFORMED_MANIFEST", `${label}.schemaVersion must equal 1`);
    if (event.type !== "ATTESTATION_RECOVERY_PATCH")
      fail("MALFORMED_MANIFEST", `${label}.type is not reviewed`);
    if (event.review !== "TASK_A_APPROVED")
      fail("MALFORMED_MANIFEST", `${label}.review must equal TASK_A_APPROVED`);
    fullCommit(event.baselineCommit, `${label}.baselineCommit`);
    exact(
      event.baselineCommit,
      manifest.certifiedBaselineCommit,
      `${label}.baselineCommit`,
    );
    fullCommit(event.targetBaselineCommit, `${label}.targetBaselineCommit`);
    if (!SOURCE_MAINTENANCE_CLASSIFICATIONS.has(event.classification))
      fail("MALFORMED_MANIFEST", `${label}.classification is not reviewed`);
    if (!Array.isArray(event.changes) || event.changes.length === 0)
      fail("MALFORMED_MANIFEST", `${label}.changes must not be empty`);
    const paths = new Set();
    let previousPath = "";
    for (const [changeIndex, change] of event.changes.entries()) {
      const changeLabel = `${label}.changes[${changeIndex}]`;
      strictKeys(
        change,
        ["path", "fromHash", "toHash", "fromGitBlob", "toGitBlob", "reason"],
        changeLabel,
      );
      if (typeof change.path !== "string" || change.path.length === 0)
        fail("MALFORMED_MANIFEST", `${changeLabel}.path is malformed`);
      if (typeof change.reason !== "string" || change.reason.length === 0)
        fail("MALFORMED_MANIFEST", `${changeLabel}.reason is malformed`);
      if (
        change.fromHash !== null &&
        (typeof change.fromHash !== "string" ||
          !/^sha256:[0-9a-f]{64}$/.test(change.fromHash))
      )
        fail("MALFORMED_MANIFEST", `${changeLabel}.fromHash is malformed`);
      if (
        typeof change.toHash !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(change.toHash)
      )
        fail("MALFORMED_MANIFEST", `${changeLabel}.toHash is malformed`);
      if (
        change.fromGitBlob !== null &&
        (typeof change.fromGitBlob !== "string" ||
          !/^[0-9a-f]{40}$/.test(change.fromGitBlob))
      )
        fail("MALFORMED_MANIFEST", `${changeLabel}.fromGitBlob is malformed`);
      if (
        typeof change.toGitBlob !== "string" ||
        !/^[0-9a-f]{40}$/.test(change.toGitBlob)
      )
        fail("MALFORMED_MANIFEST", `${changeLabel}.toGitBlob is malformed`);
      if (paths.has(change.path))
        fail("MALFORMED_MANIFEST", `${label} contains duplicate path changes`);
      if (previousPath !== "" && previousPath.localeCompare(change.path) >= 0)
        fail(
          "MALFORMED_MANIFEST",
          `${label}.changes must use ascending path order`,
        );
      paths.add(change.path);
      previousPath = change.path;
    }
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function parseCertifiedKernelManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    fail("MALFORMED_MANIFEST", "certified-kernel.json is not valid JSON");
  }
  const topKeys =
    manifest.sourceMaintenance !== undefined
      ? [...TOP_LEVEL_KEYS, "sourceMaintenance"]
      : TOP_LEVEL_KEYS;
  strictKeys(manifest, topKeys, "certified-kernel.json");
  exact(manifest.schemaVersion, 2, "schemaVersion");
  exact(manifest.protocolVersion, "pact-v1", "protocolVersion");
  for (const [field, expected] of Object.entries(EXPECTED_PROVENANCE)) {
    fullCommit(manifest[field], field);
    exact(manifest[field], expected, field);
  }
  if (
    !Array.isArray(manifest.protectedPaths) ||
    manifest.protectedPaths.some(
      (path) => typeof path !== "string" || path.length === 0,
    )
  )
    fail("MALFORMED_MANIFEST", "protectedPaths must be nonempty strings");
  if (new Set(manifest.protectedPaths).size !== manifest.protectedPaths.length)
    fail("MALFORMED_MANIFEST", "protectedPaths contains duplicates");
  if (
    JSON.stringify(manifest.protectedPaths) !==
    JSON.stringify(REQUIRED_PROTECTED_PATHS)
  )
    fail(
      "PROTECTED_PATH_POLICY_MISMATCH",
      "protectedPaths must exactly match the reviewed fail-closed policy",
    );

  strictKeys(
    manifest.contractArtifacts,
    ["toolchain", "artifacts", "creationCodeHashes"],
    "contractArtifacts",
  );
  strictKeys(
    manifest.contractArtifacts.toolchain,
    ["solidity", "evmTarget", "foundry", "openZeppelin"],
    "contractArtifacts.toolchain",
  );
  const toolchain = manifest.contractArtifacts.toolchain;
  exact(toolchain.solidity, "0.8.28", "toolchain.solidity");
  exact(toolchain.evmTarget, "cancun", "toolchain.evmTarget");
  exact(toolchain.foundry, "1.8.3", "toolchain.foundry");
  exact(toolchain.openZeppelin, "5.6.1", "toolchain.openZeppelin");
  const artifactKeys = [
    "erc8183Implementation",
    "erc1967Proxy",
    "pactEvaluator",
  ];
  strictKeys(
    manifest.contractArtifacts.artifacts,
    artifactKeys,
    "contractArtifacts.artifacts",
  );
  strictKeys(
    manifest.contractArtifacts.creationCodeHashes,
    artifactKeys,
    "contractArtifacts.creationCodeHashes",
  );
  for (const key of artifactKeys) {
    const artifact = manifest.contractArtifacts.artifacts[key];
    if (typeof artifact !== "string" || !artifact.endsWith(".json"))
      fail("MALFORMED_MANIFEST", `invalid artifact path for ${key}`);
    hash32(
      manifest.contractArtifacts.creationCodeHashes[key],
      `creationCodeHashes.${key}`,
    );
    exact(
      manifest.contractArtifacts.creationCodeHashes[key],
      EXPECTED_CONTRACT_IDENTITIES[key],
      `creationCodeHashes.${key}`,
    );
  }

  strictKeys(
    manifest.dependencyProtection,
    [
      "lockfile",
      "lockfileVersion",
      "selectedDependencies",
      "baselineFingerprint",
      "fingerprint",
      "resolvedDependencyEntries",
      "maintenance",
    ],
    "dependencyProtection",
  );
  exact(
    manifest.dependencyProtection.lockfile,
    "package-lock.json",
    "lockfile",
  );
  exact(manifest.dependencyProtection.lockfileVersion, 3, "lockfileVersion");
  if (
    typeof manifest.dependencyProtection.selectedDependencies !== "object" ||
    manifest.dependencyProtection.selectedDependencies === null ||
    Array.isArray(manifest.dependencyProtection.selectedDependencies)
  )
    fail("MALFORMED_MANIFEST", "selectedDependencies must be an object");
  for (const [importer, dependencies] of Object.entries(
    manifest.dependencyProtection.selectedDependencies,
  )) {
    if (
      typeof importer !== "string" ||
      !Array.isArray(dependencies) ||
      dependencies.some((dependency) => typeof dependency !== "string") ||
      new Set(dependencies).size !== dependencies.length
    )
      fail("MALFORMED_MANIFEST", `invalid dependency roots for ${importer}`);
  }
  dependencyFingerprint(
    manifest.dependencyProtection.baselineFingerprint,
    "dependencyProtection.baselineFingerprint",
  );
  dependencyFingerprint(
    manifest.dependencyProtection.fingerprint,
    "dependencyProtection.fingerprint",
  );
  if (
    !Number.isSafeInteger(
      manifest.dependencyProtection.resolvedDependencyEntries,
    ) ||
    manifest.dependencyProtection.resolvedDependencyEntries <= 0
  )
    fail(
      "MALFORMED_MANIFEST",
      "resolvedDependencyEntries must be a positive integer",
    );
  validateDependencyMaintenance(manifest.dependencyProtection);
  validateSourceMaintenance(manifest);
  return Object.freeze(manifest);
}

export function loadCertifiedKernelManifest(repository) {
  return parseCertifiedKernelManifest(
    readFileSync(join(repository, "certified-kernel.json"), "utf8"),
  );
}

function runGit(repository, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitSucceeds(repository, args) {
  const result = spawnSync("git", args, { cwd: repository, stdio: "ignore" });
  return result.status === 0;
}

function globRegex(pattern) {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => globRegex(pattern).test(path));
}

export function verifyProtectedPaths(repository, manifest) {
  const baseline = manifest.certifiedBaselineCommit;
  if (!gitSucceeds(repository, ["cat-file", "-e", `${baseline}^{commit}`]))
    fail("BASELINE_COMMIT_MISSING", `Git lacks baseline ${baseline}`);
  const baselineFiles = runGit(repository, [
    "ls-tree",
    "-r",
    "--name-only",
    baseline,
  ])
    .split("\n")
    .filter(Boolean);
  const sourceMaintenancePaths = new Set(
    (manifest.sourceMaintenance ?? []).flatMap((event) =>
      event.changes.map((c) => c.path),
    ),
  );
  for (const pattern of manifest.protectedPaths) {
    const existsAtBaseline = baselineFiles.some((path) =>
      globRegex(pattern).test(path),
    );
    const existsInMaintenance = [...sourceMaintenancePaths].some((path) =>
      globRegex(pattern).test(path),
    );
    if (!existsAtBaseline && !existsInMaintenance)
      fail(
        "UNKNOWN_PROTECTED_PATH",
        `protected path does not exist at baseline or certified maintenance: ${pattern}`,
      );
  }
  const changed = runGit(repository, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    baseline,
    "--",
    ".",
  ])
    .split("\n")
    .filter(Boolean)
    .filter((path) => matchesAny(path, manifest.protectedPaths));
  const untracked = runGit(repository, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ])
    .split("\n")
    .filter(Boolean)
    .filter((path) => matchesAny(path, manifest.protectedPaths));
  const drift = [...new Set([...changed, ...untracked])].sort();
  const historicalProtectedFileCount = baselineFiles.filter((path) =>
    matchesAny(path, manifest.protectedPaths),
  ).length;
  const currentFiles = runGit(repository, ["ls-files"])
    .split("\n")
    .filter(Boolean);
  const currentProtectedFileCount = currentFiles.filter((path) =>
    matchesAny(path, manifest.protectedPaths),
  ).length;

  if (drift.length === 0) {
    return {
      protectedFileCount: historicalProtectedFileCount,
      historicalProtectedFileCount,
      currentProtectedFileCount: historicalProtectedFileCount,
      certifiedChangesCount: 0,
    };
  }
  if (!manifest.sourceMaintenance || manifest.sourceMaintenance.length === 0) {
    fail(
      "PROTECTED_SOURCE_DRIFT",
      `${drift.length} protected path(s) differ from the certified baseline`,
      drift,
    );
  }
  const reviewedChanges = new Map();
  for (const event of manifest.sourceMaintenance) {
    for (const change of event.changes) {
      if (reviewedChanges.has(change.path)) {
        fail(
          "DUPLICATE_SOURCE_CHANGE",
          `duplicate certified change for ${change.path}`,
        );
      }
      reviewedChanges.set(change.path, change);
    }
  }
  const unreviewed = drift.filter((path) => !reviewedChanges.has(path));
  if (unreviewed.length > 0) {
    fail(
      "PROTECTED_SOURCE_DRIFT",
      `${unreviewed.length} protected path(s) differ from the certified baseline without review`,
      unreviewed,
    );
  }
  const missingFromDrift = [...reviewedChanges.keys()].filter(
    (path) => !drift.includes(path),
  );
  if (missingFromDrift.length > 0) {
    fail(
      "PROTECTED_SOURCE_DRIFT",
      `${missingFromDrift.length} certified source change(s) are missing from the working tree`,
      missingFromDrift,
    );
  }

  for (const event of manifest.sourceMaintenance) {
    try {
      runGit(repository, [
        "cat-file",
        "-e",
        `${event.targetBaselineCommit}^{commit}`,
      ]);
    } catch {
      fail(
        "TARGET_BASELINE_COMMIT_MISSING",
        `targetBaselineCommit does not exist in git: ${event.targetBaselineCommit}`,
      );
    }
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", event.targetBaselineCommit, "HEAD"],
        { cwd: repository, stdio: "ignore" },
      );
    } catch {
      fail(
        "TARGET_BASELINE_NOT_ANCESTOR",
        `targetBaselineCommit ${event.targetBaselineCommit} is not an ancestor of HEAD`,
      );
    }
    for (const change of event.changes) {
      let targetBlob;
      try {
        targetBlob = runGit(repository, [
          "rev-parse",
          `${event.targetBaselineCommit}:${change.path}`,
        ]);
      } catch {
        fail(
          "TARGET_FILE_MISSING",
          `target baseline commit missing file: ${change.path}`,
        );
      }
      if (targetBlob !== change.toGitBlob) {
        fail(
          "TARGET_BLOB_MISMATCH",
          `${change.path} git blob in ${event.targetBaselineCommit} does not match certified toGitBlob`,
          [`expected=${change.toGitBlob}`, `actual=${targetBlob}`],
        );
      }
      const targetContent = execFileSync(
        "git",
        ["show", `${event.targetBaselineCommit}:${change.path}`],
        { cwd: repository },
      );
      const targetSha = sha256(targetContent);
      if (targetSha !== change.toHash) {
        fail(
          "TARGET_HASH_MISMATCH",
          `${change.path} content hash in ${event.targetBaselineCommit} does not match certified toHash`,
          [`expected=${change.toHash}`, `actual=${targetSha}`],
        );
      }
    }
  }

  for (const path of drift) {
    const reviewed = reviewedChanges.get(path);
    const absolute = join(repository, path);
    if (!existsSync(absolute)) {
      fail("MISSING_PROTECTED_FILE", `certified file does not exist: ${path}`);
    }
    const currentContent = readFileSync(absolute);
    const currentSha = sha256(currentContent);
    if (currentSha !== reviewed.toHash) {
      fail(
        "PROTECTED_SOURCE_DRIFT",
        `${path} content hash does not match certified target hash`,
        [`expected=${reviewed.toHash}`, `actual=${currentSha}`],
      );
    }
    const currentBlob = runGit(repository, ["hash-object", path]);
    if (currentBlob !== reviewed.toGitBlob) {
      fail(
        "PROTECTED_SOURCE_DRIFT",
        `${path} git blob hash does not match certified target git blob`,
        [`expected=${reviewed.toGitBlob}`, `actual=${currentBlob}`],
      );
    }
    if (reviewed.fromHash !== null) {
      let baselineContent;
      try {
        baselineContent = execFileSync("git", ["show", `${baseline}:${path}`], {
          cwd: repository,
        });
      } catch {
        fail(
          "BASELINE_FILE_MISSING",
          `historical baseline missing file: ${path}`,
        );
      }
      const baselineSha = sha256(baselineContent);
      if (baselineSha !== reviewed.fromHash) {
        fail(
          "BASELINE_HASH_MISMATCH",
          `${path} baseline hash mismatch in maintenance record`,
          [`expected=${reviewed.fromHash}`, `actual=${baselineSha}`],
        );
      }
      let baselineBlob;
      try {
        baselineBlob = runGit(repository, ["rev-parse", `${baseline}:${path}`]);
      } catch {
        fail(
          "BASELINE_FILE_MISSING",
          `historical baseline missing blob: ${path}`,
        );
      }
      if (baselineBlob !== reviewed.fromGitBlob) {
        fail(
          "BASELINE_HASH_MISMATCH",
          `${path} baseline git blob mismatch in maintenance record`,
          [`expected=${reviewed.fromGitBlob}`, `actual=${baselineBlob}`],
        );
      }
    } else {
      if (baselineFiles.includes(path)) {
        fail(
          "NEW_FILE_BASELINE_CONFLICT",
          `${path} is declared new but exists at baseline`,
        );
      }
    }
  }
  return {
    protectedFileCount: currentProtectedFileCount,
    historicalProtectedFileCount,
    currentProtectedFileCount,
    certifiedChangesCount: drift.length,
  };
}

function packageCandidates(importer, dependency) {
  const candidates = [];
  let cursor = importer;
  while (cursor.length > 0) {
    candidates.push(`${cursor}/node_modules/${dependency}`);
    const marker = cursor.lastIndexOf("/node_modules/");
    if (marker >= 0) cursor = cursor.slice(0, marker);
    else cursor = dirname(cursor) === "." ? "" : dirname(cursor);
  }
  candidates.push(`node_modules/${dependency}`);
  return [...new Set(candidates)];
}

function resolveLockDependency(packages, importer, dependency, optional) {
  const path = packageCandidates(importer, dependency).find(
    (candidate) => packages[candidate] !== undefined,
  );
  if (path === undefined && !optional)
    fail(
      "DEPENDENCY_RESOLUTION_MISSING",
      `cannot resolve ${dependency} from ${importer || "root"}`,
    );
  return path;
}

function dependencyFields(record) {
  const fields = {};
  for (const key of [
    "version",
    "resolved",
    "integrity",
    "link",
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
  ]) {
    if (record[key] !== undefined) fields[key] = record[key];
  }
  return fields;
}

function computeDependencySnapshotFromLock(lock, protection) {
  exact(
    lock.lockfileVersion,
    protection.lockfileVersion,
    "package-lock version",
  );
  if (typeof lock.packages !== "object" || lock.packages === null)
    fail("DEPENDENCY_LOCK_MALFORMED", "package-lock packages map is missing");
  const selected = [];
  const queue = [];
  for (const [importer, dependencies] of Object.entries(
    protection.selectedDependencies,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const record = lock.packages[importer];
    if (record === undefined)
      fail("DEPENDENCY_IMPORTER_MISSING", `missing lock importer ${importer}`);
    for (const dependency of [...dependencies].sort()) {
      const sections = [
        record.dependencies,
        record.devDependencies,
        record.optionalDependencies,
      ];
      const spec = sections.find(
        (section) => section?.[dependency] !== undefined,
      )?.[dependency];
      if (spec === undefined)
        fail(
          "DEPENDENCY_ROOT_MISSING",
          `${dependency} is not declared by ${importer || "root"}`,
        );
      const resolved = resolveLockDependency(
        lock.packages,
        importer,
        dependency,
        false,
      );
      selected.push({ importer, dependency, spec, resolved });
      queue.push(resolved);
    }
  }

  const included = new Map();
  while (queue.length > 0) {
    const path = queue.shift();
    if (included.has(path)) continue;
    const record = lock.packages[path];
    if (record === undefined)
      fail("DEPENDENCY_RESOLUTION_MISSING", `missing lock entry ${path}`);
    included.set(path, dependencyFields(record));
    if (record.link === true) {
      if (
        typeof record.resolved !== "string" ||
        lock.packages[record.resolved] === undefined
      )
        fail("DEPENDENCY_LINK_MISSING", `invalid workspace link ${path}`);
      queue.push(record.resolved);
      continue;
    }
    for (const [sectionName, optional] of [
      ["dependencies", false],
      ["optionalDependencies", true],
      ["peerDependencies", true],
    ]) {
      for (const dependency of Object.keys(record[sectionName] ?? {}).sort()) {
        const isOptionalPeer =
          sectionName === "peerDependencies" &&
          record.peerDependenciesMeta?.[dependency]?.optional === true;
        const resolved = resolveLockDependency(
          lock.packages,
          path,
          dependency,
          optional || isOptionalPeer,
        );
        if (resolved !== undefined) queue.push(resolved);
      }
    }
  }
  const payload = {
    selected,
    packages: [...included.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  };
  return {
    fingerprint: sha256(canonical(payload)),
    packageCount: included.size,
    packageEntries: payload.packages,
  };
}

export function computeDependencyFingerprint(repository, protection) {
  const lock = JSON.parse(
    readFileSync(join(repository, protection.lockfile), "utf8"),
  );
  return computeDependencySnapshotFromLock(lock, protection);
}

function dependencyPackageName(path) {
  const marker = path.lastIndexOf("node_modules/");
  return marker === -1 ? path : path.slice(marker + "node_modules/".length);
}

function verifyDependencyMaintenanceDiff(baseline, current, maintenance) {
  const expected = new Map();
  for (const event of maintenance) {
    for (const change of event.changes) {
      const existing = expected.get(change.package);
      if (existing === undefined) {
        expected.set(change.package, { from: change.from, to: change.to });
      } else {
        if (existing.to !== change.from)
          fail(
            "DEPENDENCY_MAINTENANCE_VERSION_CHAIN_BROKEN",
            `${change.package} maintenance versions are not contiguous`,
          );
        existing.to = change.to;
      }
    }
  }

  const baselineEntries = new Map(baseline.packageEntries);
  const currentEntries = new Map(current.packageEntries);
  const paths = new Set([...baselineEntries.keys(), ...currentEntries.keys()]);
  const seen = new Set();
  const changes = [];
  for (const path of [...paths].sort()) {
    const before = baselineEntries.get(path);
    const after = currentEntries.get(path);
    if (canonical(before) === canonical(after)) continue;
    if (before === undefined || after === undefined)
      fail(
        "DEPENDENCY_MAINTENANCE_DIFF_MISMATCH",
        `selected dependency entry was added or removed: ${path}`,
      );
    const packageName = dependencyPackageName(path);
    const reviewed = expected.get(packageName);
    if (reviewed === undefined)
      fail(
        "DEPENDENCY_MAINTENANCE_DIFF_MISMATCH",
        `unrecorded selected dependency change: ${path}`,
      );
    if (before.version !== reviewed.from || after.version !== reviewed.to)
      fail(
        "DEPENDENCY_MAINTENANCE_DIFF_MISMATCH",
        `${packageName} versions do not match the maintenance record`,
      );
    seen.add(packageName);
    changes.push({
      package: packageName,
      from: before.version,
      to: after.version,
      path,
    });
  }
  for (const packageName of expected.keys()) {
    if (!seen.has(packageName))
      fail(
        "DEPENDENCY_MAINTENANCE_DIFF_MISMATCH",
        `recorded maintenance has no selected dependency change: ${packageName}`,
      );
  }
  return changes;
}

export function verifyDependencyProtection(repository, manifest) {
  const protection = manifest.dependencyProtection;
  let baselineLock;
  try {
    baselineLock = JSON.parse(
      runGit(repository, [
        "show",
        `${manifest.certifiedBaselineCommit}:${protection.lockfile}`,
      ]),
    );
  } catch {
    fail(
      "DEPENDENCY_BASELINE_LOCK_MISSING",
      "historical certified dependency lockfile is unavailable",
    );
  }
  const baseline = computeDependencySnapshotFromLock(baselineLock, protection);
  if (baseline.fingerprint !== protection.baselineFingerprint)
    fail(
      "DEPENDENCY_BASELINE_FINGERPRINT_MISMATCH",
      "historical dependency closure does not match its immutable fingerprint",
      [
        `expected=${protection.baselineFingerprint}`,
        `actual=${baseline.fingerprint}`,
      ],
    );
  const current = computeDependencyFingerprint(repository, protection);
  if (current.fingerprint !== protection.fingerprint)
    fail(
      "KERNEL_DEPENDENCY_DRIFT",
      "resolved certified-kernel dependency closure changed",
      [`expected=${protection.fingerprint}`, `actual=${current.fingerprint}`],
    );
  if (current.packageCount !== protection.resolvedDependencyEntries)
    fail(
      "DEPENDENCY_ENTRY_COUNT_MISMATCH",
      "resolved dependency entry count changed",
      [
        `expected=${protection.resolvedDependencyEntries}`,
        `actual=${current.packageCount}`,
      ],
    );
  const changes = verifyDependencyMaintenanceDiff(
    baseline,
    current,
    protection.maintenance,
  );
  return {
    packageCount: current.packageCount,
    baselineFingerprint: baseline.fingerprint,
    fingerprint: current.fingerprint,
    maintenanceEvents: protection.maintenance.length,
    changes,
  };
}

export function assertDependencyProtection(repository, protection) {
  const result = computeDependencyFingerprint(repository, protection);
  if (result.fingerprint !== protection.fingerprint)
    fail(
      "KERNEL_DEPENDENCY_DRIFT",
      "resolved certified-kernel dependency closure changed",
      [`expected=${protection.fingerprint}`, `actual=${result.fingerprint}`],
    );
  if (result.packageCount !== protection.resolvedDependencyEntries)
    fail(
      "DEPENDENCY_ENTRY_COUNT_MISMATCH",
      "resolved dependency entry count changed",
    );
  return result;
}

function resolveForge() {
  const direct = spawnSync("forge", ["--version"], { encoding: "utf8" });
  if (direct.status === 0) return "forge";
  const foundry = join(homedir(), ".foundry", "bin", "forge");
  if (existsSync(foundry)) return foundry;
  fail("FOUNDRY_MISSING", "Foundry forge is not installed");
}

export function assertContractIdentityValues(expected, actual) {
  for (const [name, identity] of Object.entries(expected)) {
    if (actual[name] !== identity)
      fail("CONTRACT_IDENTITY_MISMATCH", `${name} creation identity mismatch`, [
        `expected=${identity}`,
        `actual=${actual[name] ?? "missing"}`,
      ]);
  }
}

export function verifyContractArtifacts(repository, contractConfig) {
  const forge = resolveForge();
  const version = execFileSync(forge, ["--version"], { encoding: "utf8" });
  if (!version.includes("1.8.3"))
    fail(
      "FOUNDRY_VERSION_MISMATCH",
      `expected Foundry 1.8.3: ${version.trim()}`,
    );
  execFileSync(forge, ["build"], {
    cwd: join(repository, "packages/contracts"),
    stdio: "inherit",
  });
  const actual = {};
  for (const [name, artifactPath] of Object.entries(contractConfig.artifacts)) {
    const artifact = JSON.parse(
      readFileSync(join(repository, artifactPath), "utf8"),
    );
    if (typeof artifact.bytecode?.object !== "string")
      fail(
        "CONTRACT_ARTIFACT_MALFORMED",
        `${artifactPath} lacks creation bytecode`,
      );
    actual[name] = keccak256(artifact.bytecode.object);
  }
  assertContractIdentityValues(contractConfig.creationCodeHashes, actual);
  const foundryPin = readFileSync(
    join(repository, "packages/contracts/FOUNDRY_VERSION"),
    "utf8",
  ).trim();
  exact(foundryPin, "v1.8.3", "FOUNDRY_VERSION");
  const foundryConfig = readFileSync(
    join(repository, "packages/contracts/foundry.toml"),
    "utf8",
  );
  if (!/^solc_version\s*=\s*"0\.8\.28"/m.test(foundryConfig))
    fail("SOLIDITY_VERSION_MISMATCH", "foundry.toml must pin Solidity 0.8.28");
  if (!/^evm_version\s*=\s*"cancun"/m.test(foundryConfig))
    fail("EVM_TARGET_MISMATCH", "foundry.toml must pin cancun");
  const dependencyLock = readFileSync(
    join(repository, "packages/contracts/SOLIDITY_DEPENDENCIES.lock"),
    "utf8",
  );
  if (!dependencyLock.includes("openzeppelin-contracts v5.6.1"))
    fail("SOLIDITY_DEPENDENCY_DRIFT", "OpenZeppelin 5.6.1 pin missing");
  if (!dependencyLock.includes(EXPECTED_PROVENANCE.erc8183SourceCommit))
    fail("ERC8183_PIN_MISMATCH", "pinned ERC-8183 source commit missing");
  return actual;
}

export function verifyProvenance(repository, manifest) {
  const {
    testnetCertifiedRuntimeCommit,
    mainnetExecutionReleaseCommit,
    certifiedBaselineCommit,
  } = manifest;
  if (
    !gitSucceeds(repository, [
      "merge-base",
      "--is-ancestor",
      testnetCertifiedRuntimeCommit,
      mainnetExecutionReleaseCommit,
    ])
  )
    fail(
      "PROVENANCE_ANCESTRY_FAILURE",
      "Testnet runtime is not an ancestor of Mainnet release",
    );
  if (
    !gitSucceeds(repository, [
      "merge-base",
      "--is-ancestor",
      mainnetExecutionReleaseCommit,
      certifiedBaselineCommit,
    ])
  )
    fail(
      "PROVENANCE_ANCESTRY_FAILURE",
      "Mainnet release is not an ancestor of evidence baseline",
    );
  return true;
}

async function verifyCertificationManifests(repository, manifest) {
  execFileSync("npm", ["run", "build", "--workspace=@pact/protocol"], {
    cwd: repository,
    stdio: "ignore",
  });
  for (const workspace of [
    "@pact/verifier",
    "@pact/database",
    "@pact/orchestrator",
  ])
    execFileSync("npm", ["run", "build", `--workspace=${workspace}`], {
      cwd: repository,
      stdio: "ignore",
    });
  const moduleUrl = `${
    pathToFileURL(
      join(repository, "packages/orchestrator/dist/deployment/manifest.js"),
    ).href
  }?kernel=${Date.now()}`;
  const { assertDeploymentManifest, assertMainnetManifestProvenance } =
    await import(moduleUrl);
  const testnet = assertDeploymentManifest(
    JSON.parse(
      readFileSync(join(repository, "deployments/arc-testnet.json"), "utf8"),
    ),
  );
  const mainnet = assertDeploymentManifest(
    JSON.parse(
      readFileSync(join(repository, "deployments/arc-mainnet.json"), "utf8"),
    ),
  );
  assertMainnetManifestProvenance(mainnet, testnet);
  exact(
    testnet.testnetGate?.e2eRuntimeCommit,
    manifest.testnetCertifiedRuntimeCommit,
    "testnet manifest runtime commit",
  );
  exact(
    mainnet.mainnetGate?.mainnetReleaseCommit,
    manifest.mainnetExecutionReleaseCommit,
    "mainnet manifest release commit",
  );
  exact(
    mainnet.mainnetGate?.testnetCertifiedRuntimeCommit,
    manifest.testnetCertifiedRuntimeCommit,
    "mainnet manifest testnet provenance",
  );
  exact(
    mainnet.erc8183.sourceCommit,
    manifest.erc8183SourceCommit,
    "mainnet ERC-8183 source commit",
  );
  return {
    testnet: testnet.testnetGate.status,
    mainnet: mainnet.mainnetGate.status,
  };
}

export async function runKernelVerification(repository = process.cwd()) {
  const root = resolve(repository);
  const manifest = loadCertifiedKernelManifest(root);
  const paths = verifyProtectedPaths(root, manifest);
  verifyProvenance(root, manifest);
  const dependencies = verifyDependencyProtection(root, manifest);
  const contracts = verifyContractArtifacts(root, manifest.contractArtifacts);
  const certifications = await verifyCertificationManifests(root, manifest);
  return {
    status: "PASS",
    protocolVersion: manifest.protocolVersion,
    protectedFileCount: paths.protectedFileCount,
    historicalProtectedFileCount: paths.historicalProtectedFileCount,
    currentProtectedFileCount: paths.currentProtectedFileCount,
    dependencyPackageCount: dependencies.packageCount,
    dependencyVerification: {
      historicalBaselineFingerprint: "PASS",
      maintenanceChain: "PASS",
      currentEffectiveFingerprint: "PASS",
      baselineFingerprint: dependencies.baselineFingerprint,
      fingerprint: dependencies.fingerprint,
      maintenanceEvents: dependencies.maintenanceEvents,
      changes: dependencies.changes,
    },
    contracts,
    certifications,
    provenance: {
      testnetRuntime: manifest.testnetCertifiedRuntimeCommit,
      mainnetRelease: manifest.mainnetExecutionReleaseCommit,
      evidenceBaseline: manifest.certifiedBaselineCommit,
    },
  };
}
