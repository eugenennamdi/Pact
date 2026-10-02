#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  EXPECTED_CONTRACT_IDENTITIES,
  KernelVerificationError,
  assertContractIdentityValues,
  computeDependencyFingerprint,
  loadCertifiedKernelManifest,
  parseCertifiedKernelManifest,
  verifyProtectedPaths,
} from "./lib/certified-kernel.mjs";

const repository = resolve(process.cwd());
const manifest = loadCertifiedKernelManifest(repository);
const temporary = mkdtempSync(join(tmpdir(), "pact-kernel-negative-"));
const fixture = join(temporary, "repository");
const results = [];

function record(name, expected, outcome) {
  results.push({ name, expected, outcome });
  if (expected !== outcome)
    throw new Error(`${name}: expected ${expected}, received ${outcome}`);
}

function expectPass(name, operation) {
  operation();
  record(name, "PASS", "PASS");
}

function expectFail(name, operation) {
  try {
    operation();
    record(name, "FAIL", "PASS");
  } catch (error) {
    if (!(error instanceof KernelVerificationError)) throw error;
    record(name, "FAIL", "FAIL");
  }
}

function mutateFile(name, path, operation = (value) => `${value}\n// drift\n`) {
  const absolute = join(fixture, path);
  const original = readFileSync(absolute, "utf8");
  try {
    writeFileSync(absolute, operation(original));
    expectFail(name, () => verifyProtectedPaths(fixture, manifest));
  } finally {
    writeFileSync(absolute, original);
  }
}

try {
  execFileSync(
    "git",
    ["clone", "--quiet", "--no-hardlinks", repository, fixture],
    { stdio: "inherit" },
  );
  execFileSync(
    "git",
    ["checkout", "--quiet", manifest.certifiedBaselineCommit],
    {
      cwd: fixture,
      stdio: "inherit",
    },
  );

  expectPass("1 untouched certified baseline", () =>
    verifyProtectedPaths(fixture, manifest),
  );

  const productFile = join(fixture, "packages/product/src/new-feature.ts");
  mkdirSync(join(fixture, "packages/product/src"), { recursive: true });
  writeFileSync(productFile, "export const productOnly = true;\n");
  expectPass("2 product-only new file", () =>
    verifyProtectedPaths(fixture, manifest),
  );
  rmSync(join(fixture, "packages/product"), { recursive: true, force: true });

  mutateFile("3 condition hashing drift", "packages/protocol/src/condition.ts");
  mutateFile("4 evidence hashing drift", "packages/protocol/src/evidence.ts");
  mutateFile("5 Attestation V2 drift", "packages/protocol/src/attestation.ts");
  mutateFile(
    "6 PactEvaluator drift",
    "packages/contracts/src/PactEvaluator.sol",
  );
  mutateFile(
    "7 pinned ERC-8183 drift",
    "packages/contracts/lib/erc8183-base-contracts/contracts/ERC8183.sol",
  );
  mutateFile(
    "8 GitHub verifier drift",
    "packages/verifier/src/github/verify.ts",
  );
  mutateFile(
    "9 Phase 4A reconciliation drift",
    "packages/orchestrator/src/reconcile.ts",
  );
  mutateFile(
    "10 relay calldata/signing drift",
    "packages/orchestrator/src/relay/signer.ts",
  );
  mutateFile(
    "11 nonce/broadcast drift",
    "packages/database/src/relay-repository.ts",
  );
  mutateFile("12 DB uniqueness/CAS drift", "packages/database/src/schema.ts");
  mutateFile(
    "13 deployment/operator drift",
    "packages/orchestrator/src/deployment/operator.ts",
  );
  mutateFile("14 Testnet manifest tamper", "deployments/arc-testnet.json");
  mutateFile("15 Mainnet manifest tamper", "deployments/arc-mainnet.json");

  expectFail("16 contract artifact mismatch", () =>
    assertContractIdentityValues(EXPECTED_CONTRACT_IDENTITIES, {
      ...EXPECTED_CONTRACT_IDENTITIES,
      pactEvaluator: `0x${"0".repeat(64)}`,
    }),
  );

  const missing = join(fixture, "packages/protocol/src/condition.ts");
  const missingContents = readFileSync(missing, "utf8");
  try {
    unlinkSync(missing);
    expectFail("17 missing protected file", () =>
      verifyProtectedPaths(fixture, manifest),
    );
  } finally {
    writeFileSync(missing, missingContents);
  }

  expectFail("18 malformed certified-kernel.json", () =>
    parseCertifiedKernelManifest('{"schemaVersion":1,"unknown":true}'),
  );

  const component = join(fixture, "apps/web/app/product-card.tsx");
  writeFileSync(component, "export default function Card() { return null; }\n");
  expectPass("19 legitimate product code outside kernel", () =>
    verifyProtectedPaths(fixture, manifest),
  );
  unlinkSync(component);

  const generated = join(fixture, "packages/protocol/dist/generated.js");
  mkdirSync(join(fixture, "packages/protocol/dist"), { recursive: true });
  writeFileSync(generated, "export const generated = true;\n");
  expectPass("20 generated output difference", () =>
    verifyProtectedPaths(fixture, manifest),
  );

  const lockPath = join(fixture, "package-lock.json");
  const originalLock = readFileSync(lockPath, "utf8");
  try {
    const lock = JSON.parse(originalLock);
    lock.packages["apps/web"].dependencies["product-only-fixture"] = "1.0.0";
    lock.packages["node_modules/product-only-fixture"] = {
      version: "1.0.0",
      resolved:
        "https://registry.npmjs.org/product-only-fixture/-/product-only-fixture-1.0.0.tgz",
      integrity: "sha512-product-only-fixture",
    };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const productFingerprint = computeDependencyFingerprint(
      fixture,
      manifest.dependencyProtection,
    ).fingerprint;
    record(
      "21 product-only dependency addition",
      "PASS",
      productFingerprint === manifest.dependencyProtection.fingerprint
        ? "PASS"
        : "FAIL",
    );
  } finally {
    writeFileSync(lockPath, originalLock);
  }

  try {
    const lock = JSON.parse(originalLock);
    lock.packages["node_modules/viem"].integrity = "sha512-kernel-drift";
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const kernelFingerprint = computeDependencyFingerprint(
      fixture,
      manifest.dependencyProtection,
    ).fingerprint;
    record(
      "22 kernel dependency resolution drift",
      "FAIL",
      kernelFingerprint === manifest.dependencyProtection.fingerprint
        ? "PASS"
        : "FAIL",
    );
  } finally {
    writeFileSync(lockPath, originalLock);
  }

  console.log(`[certified-kernel-test] PASS: ${results.length} cases`);
  console.log(JSON.stringify({ status: "PASS", cases: results }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
