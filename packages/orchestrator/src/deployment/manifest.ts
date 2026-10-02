import { readFile } from "node:fs/promises";
import {
  getAddress,
  isAddress,
  isHash,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

export const ARC_MAINNET_CHAIN_ID = 5_042n;
export const ARC_TESTNET_CHAIN_ID = 5_042_002n;
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const ERC8183_SOURCE_COMMIT =
  "142e669c1fd318486a4628395b629f033654dd06" as const;
export const ERC8183_NORMATIVE_REVISION =
  "a078cab5cc8e9581c15f76c091ed96eed28f02f7" as const;
export const TESTNET_CERTIFIED_RUNTIME_COMMIT =
  "fa20328df6643b0d85f6c2b6074d79dd0e5de54c" as const;

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
  readonly mainnetGate?: {
    readonly schemaVersion: 1;
    readonly status: "PASS";
    readonly chainId: "5042";
    readonly mainnetReleaseCommit: string;
    readonly testnetCertifiedRuntimeCommit: string;
    readonly erc8183SourceCommit: typeof ERC8183_SOURCE_COMMIT;
    readonly completedAt: string;
    readonly contracts: {
      readonly implementation: Address;
      readonly proxy: Address;
      readonly pactEvaluator: Address;
    };
    readonly runtimeCodeHashes: {
      readonly erc8183Implementation: Hex;
      readonly erc8183Proxy: Hex;
      readonly pactEvaluator: Hex;
    };
    readonly roles: {
      readonly operator: Address;
      readonly treasury: Address;
      readonly provider: Address;
      readonly verifier: Address;
      readonly relay: Address;
    };
    readonly deploymentTransactions: {
      readonly implementation: Hex;
      readonly proxy: Hex;
      readonly allowUsdc: Hex;
      readonly evaluator: Hex;
    };
    readonly jobId: string;
    readonly github: {
      readonly repository: string;
      readonly pullRequest: number;
      readonly baseBranch: string;
      readonly mergeCommitSha: Hex;
      readonly mergedAt: string;
    };
    readonly conditionHash: Hex;
    readonly evidenceHash: Hex;
    readonly attestationDigest: Hex;
    readonly settlement: {
      readonly transactionHash: Hex;
      readonly receiptBlockNumber: string;
      readonly receiptBlockHash: Hex;
      readonly pactCompletionAccepted: {
        readonly blockNumber: string;
        readonly blockHash: Hex;
        readonly logIndex: number;
      };
      readonly jobCompleted: {
        readonly blockNumber: string;
        readonly blockHash: Hex;
        readonly logIndex: number;
      };
    };
    readonly broadcastAttemptCount: 1;
    readonly economics: {
      readonly budget: string;
      readonly grossFunding: string;
      readonly grossProviderPayout: string;
      readonly treasuryApplicationPayout: "0";
      readonly evaluatorApplicationPayout: "0";
      readonly settledAmount: "0";
      readonly completionReason: Hex;
    };
    readonly finalState: {
      readonly jobStatus: 3;
      readonly bindingAccepted: true;
    };
    readonly resultHash: Hex;
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

export function mainnetGateResultHash(
  gate: Omit<NonNullable<DeploymentManifest["mainnetGate"]>, "resultHash">,
): Hex {
  return keccak256(stringToHex(canonical(gate)));
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

function gitCommitSha(value: unknown, path: string): Hex {
  const raw = string(value, path);
  if (!/^0x[0-9a-f]{40}$/.test(raw))
    throw new Error(`invalid deployment manifest: ${path}`);
  return raw as Hex;
}

function integerString(value: unknown, path: string, positive = false): string {
  const raw = string(value, path);
  if (!/^(0|[1-9]\d*)$/.test(raw) || (positive && raw === "0"))
    throw new Error(`invalid deployment manifest: ${path}`);
  return raw;
}

function eventCoordinate(
  value: unknown,
  path: string,
): {
  readonly blockNumber: string;
  readonly blockHash: Hex;
  readonly logIndex: number;
} {
  const event = record(value, path);
  const blockNumber = integerString(
    event.blockNumber,
    `${path}.blockNumber`,
    true,
  );
  const blockHash = hash(event.blockHash, `${path}.blockHash`);
  if (
    typeof event.logIndex !== "number" ||
    !Number.isSafeInteger(event.logIndex) ||
    event.logIndex < 0
  )
    throw new Error(`invalid deployment manifest: ${path}.logIndex`);
  return { blockNumber, blockHash, logIndex: event.logIndex };
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

  if (root.mainnetGate !== undefined) {
    if (network !== "arc-mainnet")
      throw new Error("invalid deployment manifest: mainnetGate network");
    const gate = record(root.mainnetGate, "mainnetGate");
    literal(gate.schemaVersion, 1, "mainnetGate.schemaVersion");
    literal(gate.status, "PASS", "mainnetGate.status");
    literal(gate.chainId, "5042", "mainnetGate.chainId");
    literal(
      gate.mainnetReleaseCommit,
      gitCommit,
      "mainnetGate.mainnetReleaseCommit",
    );
    const testnetCertifiedRuntimeCommit = string(
      gate.testnetCertifiedRuntimeCommit,
      "mainnetGate.testnetCertifiedRuntimeCommit",
    );
    if (!/^[0-9a-f]{40}$/.test(testnetCertifiedRuntimeCommit))
      throw new Error(
        "invalid deployment manifest: mainnetGate.testnetCertifiedRuntimeCommit must be a full lowercase commit hash",
      );
    literal(
      gate.erc8183SourceCommit,
      ERC8183_SOURCE_COMMIT,
      "mainnetGate.erc8183SourceCommit",
    );
    isoDate(gate.completedAt, "mainnetGate.completedAt");

    const contracts = record(gate.contracts, "mainnetGate.contracts");
    literal(
      address(contracts.implementation, "mainnetGate.contracts.implementation"),
      address(erc.implementation, "erc8183.implementation"),
      "mainnetGate.contracts.implementation",
    );
    literal(
      address(contracts.proxy, "mainnetGate.contracts.proxy"),
      proxy,
      "mainnetGate.contracts.proxy",
    );
    literal(
      address(contracts.pactEvaluator, "mainnetGate.contracts.pactEvaluator"),
      address(evaluator.address, "pactEvaluator.address"),
      "mainnetGate.contracts.pactEvaluator",
    );

    const runtime = record(
      gate.runtimeCodeHashes,
      "mainnetGate.runtimeCodeHashes",
    );
    literal(
      hash(
        runtime.erc8183Implementation,
        "mainnetGate.runtimeCodeHashes.erc8183Implementation",
      ),
      hash(erc.implementationCodeHash, "erc8183.implementationCodeHash"),
      "mainnetGate.runtimeCodeHashes.erc8183Implementation",
    );
    literal(
      hash(runtime.erc8183Proxy, "mainnetGate.runtimeCodeHashes.erc8183Proxy"),
      hash(erc.proxyCodeHash, "erc8183.proxyCodeHash"),
      "mainnetGate.runtimeCodeHashes.erc8183Proxy",
    );
    literal(
      hash(
        runtime.pactEvaluator,
        "mainnetGate.runtimeCodeHashes.pactEvaluator",
      ),
      hash(evaluator.codeHash, "pactEvaluator.codeHash"),
      "mainnetGate.runtimeCodeHashes.pactEvaluator",
    );

    const roles = record(gate.roles, "mainnetGate.roles");
    literal(
      address(roles.operator, "mainnetGate.roles.operator"),
      address(root.deployer, "deployer"),
      "mainnetGate.roles.operator",
    );
    literal(
      address(roles.treasury, "mainnetGate.roles.treasury"),
      address(erc.treasury, "erc8183.treasury"),
      "mainnetGate.roles.treasury",
    );
    address(roles.provider, "mainnetGate.roles.provider");
    literal(
      address(roles.verifier, "mainnetGate.roles.verifier"),
      address(evaluator.verifier, "pactEvaluator.verifier"),
      "mainnetGate.roles.verifier",
    );
    address(roles.relay, "mainnetGate.roles.relay");

    const gateTransactions = record(
      gate.deploymentTransactions,
      "mainnetGate.deploymentTransactions",
    );
    for (const key of [
      "implementation",
      "proxy",
      "allowUsdc",
      "evaluator",
    ] as const)
      literal(
        hash(
          gateTransactions[key],
          `mainnetGate.deploymentTransactions.${key}`,
        ),
        hash(transactions[key], `deploymentTransactions.${key}`),
        `mainnetGate.deploymentTransactions.${key}`,
      );

    integerString(gate.jobId, "mainnetGate.jobId", true);
    const github = record(gate.github, "mainnetGate.github");
    string(github.repository, "mainnetGate.github.repository");
    if (
      typeof github.pullRequest !== "number" ||
      !Number.isSafeInteger(github.pullRequest) ||
      github.pullRequest <= 0
    )
      throw new Error(
        "invalid deployment manifest: mainnetGate.github.pullRequest",
      );
    string(github.baseBranch, "mainnetGate.github.baseBranch");
    gitCommitSha(github.mergeCommitSha, "mainnetGate.github.mergeCommitSha");
    isoDate(github.mergedAt, "mainnetGate.github.mergedAt");
    hash(gate.conditionHash, "mainnetGate.conditionHash");
    const evidenceHash = hash(gate.evidenceHash, "mainnetGate.evidenceHash");
    hash(gate.attestationDigest, "mainnetGate.attestationDigest");

    const settlement = record(gate.settlement, "mainnetGate.settlement");
    hash(settlement.transactionHash, "mainnetGate.settlement.transactionHash");
    const receiptBlockNumber = integerString(
      settlement.receiptBlockNumber,
      "mainnetGate.settlement.receiptBlockNumber",
      true,
    );
    const receiptBlockHash = hash(
      settlement.receiptBlockHash,
      "mainnetGate.settlement.receiptBlockHash",
    );
    const pactEvent = eventCoordinate(
      settlement.pactCompletionAccepted,
      "mainnetGate.settlement.pactCompletionAccepted",
    );
    const jobEvent = eventCoordinate(
      settlement.jobCompleted,
      "mainnetGate.settlement.jobCompleted",
    );
    if (
      pactEvent.blockNumber !== receiptBlockNumber ||
      jobEvent.blockNumber !== receiptBlockNumber ||
      pactEvent.blockHash !== receiptBlockHash ||
      jobEvent.blockHash !== receiptBlockHash
    )
      throw new Error(
        "invalid deployment manifest: mainnetGate settlement coordinates",
      );
    literal(gate.broadcastAttemptCount, 1, "mainnetGate.broadcastAttemptCount");

    const economics = record(gate.economics, "mainnetGate.economics");
    const budget = integerString(
      economics.budget,
      "mainnetGate.economics.budget",
      true,
    );
    literal(
      integerString(
        economics.grossFunding,
        "mainnetGate.economics.grossFunding",
      ),
      budget,
      "mainnetGate.economics.grossFunding",
    );
    literal(
      integerString(
        economics.grossProviderPayout,
        "mainnetGate.economics.grossProviderPayout",
      ),
      budget,
      "mainnetGate.economics.grossProviderPayout",
    );
    literal(
      economics.treasuryApplicationPayout,
      "0",
      "mainnetGate.economics.treasuryApplicationPayout",
    );
    literal(
      economics.evaluatorApplicationPayout,
      "0",
      "mainnetGate.economics.evaluatorApplicationPayout",
    );
    literal(
      economics.settledAmount,
      "0",
      "mainnetGate.economics.settledAmount",
    );
    literal(
      hash(
        economics.completionReason,
        "mainnetGate.economics.completionReason",
      ),
      evidenceHash,
      "mainnetGate.economics.completionReason",
    );
    const finalState = record(gate.finalState, "mainnetGate.finalState");
    literal(finalState.jobStatus, 3, "mainnetGate.finalState.jobStatus");
    literal(
      finalState.bindingAccepted,
      true,
      "mainnetGate.finalState.bindingAccepted",
    );
    const resultHash = hash(gate.resultHash, "mainnetGate.resultHash");
    const { resultHash: _ignored, ...resultInput } = gate;
    literal(
      resultHash,
      mainnetGateResultHash(
        resultInput as Omit<
          NonNullable<DeploymentManifest["mainnetGate"]>,
          "resultHash"
        >,
      ),
      "mainnetGate.resultHash",
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

export function assertMainnetManifestProvenance(
  input: unknown,
  testnetInput: unknown,
): DeploymentManifest {
  const mainnet = assertDeploymentManifest(input);
  const testnet = assertDeploymentManifest(testnetInput);
  if (
    mainnet.network !== "arc-mainnet" ||
    mainnet.mainnetGate?.status !== "PASS" ||
    testnet.network !== "arc-testnet" ||
    testnet.testnetGate?.status !== "PASS"
  )
    throw new Error(
      "invalid deployment manifest: canonical Testnet PASS manifest is required for Mainnet gate provenance",
    );
  literal(
    testnet.testnetGate.e2eRuntimeCommit,
    TESTNET_CERTIFIED_RUNTIME_COMMIT,
    "testnetGate.e2eRuntimeCommit",
  );
  literal(
    mainnet.mainnetGate.testnetCertifiedRuntimeCommit,
    testnet.testnetGate.e2eRuntimeCommit,
    "mainnetGate.testnetCertifiedRuntimeCommit",
  );
  return mainnet;
}

export async function loadDeploymentManifest(
  path: string,
): Promise<DeploymentManifest> {
  return assertDeploymentManifest(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
}

export { assertMainnetGate } from "./mainnet-release.js";
