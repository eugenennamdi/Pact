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
  strictKeys(manifest, TOP_LEVEL_KEYS, "certified-kernel.json");
  exact(manifest.schemaVersion, 1, "schemaVersion");
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
    ["lockfile", "lockfileVersion", "selectedDependencies", "fingerprint"],
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
  if (!/^sha256:[0-9a-f]{64}$/.test(manifest.dependencyProtection.fingerprint))
    fail("MALFORMED_MANIFEST", "dependency fingerprint must be sha256");
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
  for (const pattern of manifest.protectedPaths) {
    if (!baselineFiles.some((path) => globRegex(pattern).test(path)))
      fail(
        "UNKNOWN_PROTECTED_PATH",
        `protected path does not exist at baseline: ${pattern}`,
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
  if (drift.length > 0)
    fail(
      "PROTECTED_SOURCE_DRIFT",
      `${drift.length} protected path(s) differ from the certified baseline`,
      drift,
    );
  return {
    protectedFileCount: baselineFiles.filter((path) =>
      matchesAny(path, manifest.protectedPaths),
    ).length,
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

export function computeDependencyFingerprint(repository, protection) {
  const lock = JSON.parse(
    readFileSync(join(repository, protection.lockfile), "utf8"),
  );
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
  const dependencies = assertDependencyProtection(
    root,
    manifest.dependencyProtection,
  );
  const contracts = verifyContractArtifacts(root, manifest.contractArtifacts);
  const certifications = await verifyCertificationManifests(root, manifest);
  return {
    status: "PASS",
    protocolVersion: manifest.protocolVersion,
    protectedFileCount: paths.protectedFileCount,
    dependencyPackageCount: dependencies.packageCount,
    contracts,
    certifications,
    provenance: {
      testnetRuntime: manifest.testnetCertifiedRuntimeCommit,
      mainnetRelease: manifest.mainnetExecutionReleaseCommit,
      evidenceBaseline: manifest.certifiedBaselineCommit,
    },
  };
}
