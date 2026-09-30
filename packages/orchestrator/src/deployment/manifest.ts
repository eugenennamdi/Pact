import { readFile } from "node:fs/promises";
import { getAddress, isAddress, isHash, type Address, type Hex } from "viem";

export const ARC_MAINNET_CHAIN_ID = 5_042n;
export const ARC_TESTNET_CHAIN_ID = 5_042_002n;
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const ERC8183_SOURCE_COMMIT =
  "142e669c1fd318486a4628395b629f033654dd06" as const;
export const ERC8183_NORMATIVE_REVISION =
  "a078cab5cc8e9581c15f76c091ed96eed28f02f7" as const;

export type PactNetwork = "arc-testnet" | "arc-mainnet";

export interface DeploymentManifest {
  readonly schemaVersion: 1;
  readonly status: "DEPLOYED";
  readonly network: PactNetwork;
  readonly chainId: string;
  readonly deploymentTimestamp: string;
  readonly deploymentBlock: string;
  readonly deployer: Address;
  readonly gitCommit: string;
  readonly usdc: { readonly address: Address; readonly decimals: 6 };
  readonly erc8183: {
    readonly classification: "PACT_MANAGED_PINNED";
    readonly proxy: Address;
    readonly implementation: Address;
    readonly proxyCodeHash: Hex;
    readonly implementationCodeHash: Hex;
    readonly sourceCommit: typeof ERC8183_SOURCE_COMMIT;
    readonly normativeRevision: typeof ERC8183_NORMATIVE_REVISION;
    readonly defaultAdmin: Address;
    readonly admin: Address;
    readonly treasury: Address;
    readonly platformFeeBps: "0";
    readonly evaluatorFeeBps: "0";
    readonly paused: false;
    readonly paymentTokenAllowed: true;
    readonly hookPolicy: "NONE";
  };
  readonly pactEvaluator: {
    readonly address: Address;
    readonly codeHash: Hex;
    readonly artifactBytecodeHash: Hex;
    readonly commerceContract: Address;
    readonly verifier: Address;
    readonly admin: Address;
    readonly domainVersion: "2";
  };
  readonly toolchain: {
    readonly solidity: "0.8.28";
    readonly evmTarget: "cancun";
    readonly foundryVersion: string;
    readonly openZeppelinVersion: "5.6.1";
    readonly viemVersion: "2.56.9";
  };
  readonly deploymentTransactions: {
    readonly implementation: Hex;
    readonly proxy: Hex;
    readonly allowUsdc: Hex;
    readonly evaluator: Hex;
  };
  readonly sourceVerification: {
    readonly erc8183Implementation: "VERIFIED" | "PENDING" | "UNAVAILABLE";
    readonly erc8183Proxy: "VERIFIED" | "PENDING" | "UNAVAILABLE";
    readonly pactEvaluator: "VERIFIED" | "PENDING" | "UNAVAILABLE";
  };
  readonly testnetGate?: {
    readonly status: "PASS";
    readonly deploymentGitCommit: string;
    readonly e2eRuntimeCommit: string;
    readonly erc8183SourceCommit: typeof ERC8183_SOURCE_COMMIT;
    readonly evaluatorCodeHash: Hex;
    readonly completedAt: string;
    readonly resultHash: Hex;
    readonly jobId: string;
    readonly github: {
      readonly repository: string;
      readonly pullRequest: number;
      readonly baseBranch: string;
      readonly mergeCommitSha: Hex;
    };
    readonly conditionHash: Hex;
    readonly evidenceHash: Hex;
    readonly attestationDigest: Hex;
    readonly settlementTransactionHash: Hex;
    readonly event: {
      readonly blockNumber: string;
      readonly logIndex: number;
    };
    readonly runtimeCodeHashes: {
      readonly erc8183Proxy: Hex;
      readonly erc8183Implementation: Hex;
      readonly pactEvaluator: Hex;
    };
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`invalid deployment manifest: ${path} must be an object`);
  return value as Record<string, unknown>;
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected)
    throw new Error(
      `invalid deployment manifest: ${path} must be ${String(expected)}`,
    );
  return expected;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(
      `invalid deployment manifest: ${path} must be a non-empty string`,
    );
  return value;
}

function address(value: unknown, path: string): Address {
  const raw = string(value, path);
  if (!isAddress(raw, { strict: true }))
    throw new Error(
      `invalid deployment manifest: ${path} must be a checksummed address`,
    );
  return getAddress(raw);
}

function hash(value: unknown, path: string): Hex {
  const raw = string(value, path);
  if (!isHash(raw))
    throw new Error(
      `invalid deployment manifest: ${path} must be a 32-byte hash`,
    );
  return raw as Hex;
}

function isoDate(value: unknown, path: string): string {
  const raw = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw))
    throw new Error(
      `invalid deployment manifest: ${path} must be an ISO UTC timestamp`,
    );
  return raw;
}

export function assertDeploymentManifest(input: unknown): DeploymentManifest {
  const root = record(input, "root");
  const network = root.network;
  if (network !== "arc-testnet" && network !== "arc-mainnet")
    throw new Error("invalid deployment manifest: network is unsupported");
  const expectedChain = network === "arc-testnet" ? "5042002" : "5042";
  literal(root.schemaVersion, 1, "schemaVersion");
  literal(root.status, "DEPLOYED", "status");
  literal(root.chainId, expectedChain, "chainId");
  const deploymentBlock = string(root.deploymentBlock, "deploymentBlock");
  if (!/^(0|[1-9]\d*)$/.test(deploymentBlock))
    throw new Error(
      "invalid deployment manifest: deploymentBlock must be an integer string",
    );
  const gitCommit = string(root.gitCommit, "gitCommit");
  if (!/^[0-9a-f]{40}$/.test(gitCommit))
    throw new Error(
      "invalid deployment manifest: gitCommit must be a full lowercase commit hash",
    );

  const usdc = record(root.usdc, "usdc");
  literal(
    address(usdc.address, "usdc.address"),
    ARC_USDC_ADDRESS,
    "usdc.address",
  );
  literal(usdc.decimals, 6, "usdc.decimals");
  const erc = record(root.erc8183, "erc8183");
  literal(erc.classification, "PACT_MANAGED_PINNED", "erc8183.classification");
  literal(erc.sourceCommit, ERC8183_SOURCE_COMMIT, "erc8183.sourceCommit");
  literal(
    erc.normativeRevision,
    ERC8183_NORMATIVE_REVISION,
    "erc8183.normativeRevision",
  );
  literal(erc.platformFeeBps, "0", "erc8183.platformFeeBps");
  literal(erc.evaluatorFeeBps, "0", "erc8183.evaluatorFeeBps");
  literal(erc.paused, false, "erc8183.paused");
  literal(erc.paymentTokenAllowed, true, "erc8183.paymentTokenAllowed");
  literal(erc.hookPolicy, "NONE", "erc8183.hookPolicy");
  const evaluator = record(root.pactEvaluator, "pactEvaluator");
  literal(evaluator.domainVersion, "2", "pactEvaluator.domainVersion");
  const proxy = address(erc.proxy, "erc8183.proxy");
  literal(
    address(evaluator.commerceContract, "pactEvaluator.commerceContract"),
    proxy,
    "pactEvaluator.commerceContract",
  );
  const toolchain = record(root.toolchain, "toolchain");
  literal(toolchain.solidity, "0.8.28", "toolchain.solidity");
  literal(toolchain.evmTarget, "cancun", "toolchain.evmTarget");
  literal(
    toolchain.openZeppelinVersion,
    "5.6.1",
    "toolchain.openZeppelinVersion",
  );
  literal(toolchain.viemVersion, "2.56.9", "toolchain.viemVersion");
  string(toolchain.foundryVersion, "toolchain.foundryVersion");
  const transactions = record(
    root.deploymentTransactions,
    "deploymentTransactions",
  );
  hash(transactions.implementation, "deploymentTransactions.implementation");
  hash(transactions.proxy, "deploymentTransactions.proxy");
  hash(transactions.allowUsdc, "deploymentTransactions.allowUsdc");
  hash(transactions.evaluator, "deploymentTransactions.evaluator");
  const verification = record(root.sourceVerification, "sourceVerification");
  for (const key of [
    "erc8183Implementation",
    "erc8183Proxy",
    "pactEvaluator",
  ] as const) {
    if (
      !["VERIFIED", "PENDING", "UNAVAILABLE"].includes(
        String(verification[key]),
      )
    )
      throw new Error(`invalid deployment manifest: sourceVerification.${key}`);
  }

  if (root.testnetGate !== undefined) {
    const gate = record(root.testnetGate, "testnetGate");
    literal(gate.status, "PASS", "testnetGate.status");
    literal(
      gate.deploymentGitCommit,
      gitCommit,
      "testnetGate.deploymentGitCommit",
    );
    const e2eRuntimeCommit = string(
      gate.e2eRuntimeCommit,
      "testnetGate.e2eRuntimeCommit",
    );
    if (!/^[0-9a-f]{40}$/.test(e2eRuntimeCommit))
      throw new Error(
        "invalid deployment manifest: testnetGate.e2eRuntimeCommit must be a full lowercase commit hash",
      );
    literal(
      gate.erc8183SourceCommit,
      ERC8183_SOURCE_COMMIT,
      "testnetGate.erc8183SourceCommit",
    );
    hash(gate.evaluatorCodeHash, "testnetGate.evaluatorCodeHash");
    hash(gate.resultHash, "testnetGate.resultHash");
    isoDate(gate.completedAt, "testnetGate.completedAt");
    const jobId = string(gate.jobId, "testnetGate.jobId");
    if (!/^[1-9]\d*$/.test(jobId))
      throw new Error("invalid deployment manifest: testnetGate.jobId");
    const github = record(gate.github, "testnetGate.github");
    string(github.repository, "testnetGate.github.repository");
    const pullRequest = github.pullRequest;
    if (
      typeof pullRequest !== "number" ||
      !Number.isSafeInteger(pullRequest) ||
      pullRequest <= 0
    )
      throw new Error(
        "invalid deployment manifest: testnetGate.github.pullRequest",
      );
    string(github.baseBranch, "testnetGate.github.baseBranch");
    const mergeCommitSha = string(
      github.mergeCommitSha,
      "testnetGate.github.mergeCommitSha",
    );
    if (!/^0x[0-9a-f]{40}$/.test(mergeCommitSha))
      throw new Error(
        "invalid deployment manifest: testnetGate.github.mergeCommitSha",
      );
    hash(gate.conditionHash, "testnetGate.conditionHash");
    hash(gate.evidenceHash, "testnetGate.evidenceHash");
    hash(gate.attestationDigest, "testnetGate.attestationDigest");
    hash(
      gate.settlementTransactionHash,
      "testnetGate.settlementTransactionHash",
    );
    const event = record(gate.event, "testnetGate.event");
    const eventBlockNumber = string(
      event.blockNumber,
      "testnetGate.event.blockNumber",
    );
    if (!/^[1-9]\d*$/.test(eventBlockNumber))
      throw new Error(
        "invalid deployment manifest: testnetGate.event.blockNumber",
      );
    if (
      typeof event.logIndex !== "number" ||
      !Number.isSafeInteger(event.logIndex) ||
      event.logIndex < 0
    )
      throw new Error(
        "invalid deployment manifest: testnetGate.event.logIndex",
      );
    const runtimeCodeHashes = record(
      gate.runtimeCodeHashes,
      "testnetGate.runtimeCodeHashes",
    );
    literal(
      hash(
        runtimeCodeHashes.erc8183Proxy,
        "testnetGate.runtimeCodeHashes.erc8183Proxy",
      ),
      hash(erc.proxyCodeHash, "erc8183.proxyCodeHash"),
      "testnetGate.runtimeCodeHashes.erc8183Proxy",
    );
    literal(
      hash(
        runtimeCodeHashes.erc8183Implementation,
        "testnetGate.runtimeCodeHashes.erc8183Implementation",
      ),
      hash(erc.implementationCodeHash, "erc8183.implementationCodeHash"),
      "testnetGate.runtimeCodeHashes.erc8183Implementation",
    );
    literal(
      hash(
        runtimeCodeHashes.pactEvaluator,
        "testnetGate.runtimeCodeHashes.pactEvaluator",
      ),
      hash(evaluator.codeHash, "pactEvaluator.codeHash"),
      "testnetGate.runtimeCodeHashes.pactEvaluator",
    );
  }

  address(root.deployer, "deployer");
  isoDate(root.deploymentTimestamp, "deploymentTimestamp");
  address(erc.implementation, "erc8183.implementation");
  hash(erc.proxyCodeHash, "erc8183.proxyCodeHash");
  hash(erc.implementationCodeHash, "erc8183.implementationCodeHash");
  address(erc.defaultAdmin, "erc8183.defaultAdmin");
  address(erc.admin, "erc8183.admin");
  address(erc.treasury, "erc8183.treasury");
  address(evaluator.address, "pactEvaluator.address");
  hash(evaluator.codeHash, "pactEvaluator.codeHash");
  hash(evaluator.artifactBytecodeHash, "pactEvaluator.artifactBytecodeHash");
  address(evaluator.verifier, "pactEvaluator.verifier");
  address(evaluator.admin, "pactEvaluator.admin");
  return input as DeploymentManifest;
}

export async function loadDeploymentManifest(
  path: string,
): Promise<DeploymentManifest> {
  return assertDeploymentManifest(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
}

export { assertMainnetGate } from "./mainnet-release.js";
