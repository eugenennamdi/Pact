import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { pactRelayAbi } from "../relay/abi.js";
import {
  DEFAULT_ARC_RPC_TIMEOUT_MS,
  MAX_ARC_RPC_TIMEOUT_MS,
} from "../chain.js";
import type { DeploymentManifest } from "./manifest.js";

export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const ERC8183_ADMIN_ROLE = keccak256(stringToHex("ADMIN_ROLE"));

const erc8183ConfigurationAbi = [
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "platformTreasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "platformFeeBP",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "evaluatorFeeBP",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowedPaymentTokens",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "whitelistedHooks",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const evaluatorConfigurationAbi = [
  ...pactRelayAbi,
  {
    type: "function",
    name: "defaultVerifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const usdcAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export class DeploymentIntegrityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface DeploymentCodeSnapshot {
  readonly proxyCode: Hex | undefined;
  readonly implementationCode: Hex | undefined;
  readonly evaluatorCode: Hex | undefined;
  readonly usdcCode: Hex | undefined;
  readonly implementationSlot: Hex | undefined;
}

function equalAddress(actual: unknown, expected: Address, code: string): void {
  if (typeof actual !== "string" || getAddress(actual) !== getAddress(expected))
    throw new DeploymentIntegrityError(code);
}

export function assertDeploymentCodeSnapshot(
  manifest: DeploymentManifest,
  snapshot: DeploymentCodeSnapshot,
): void {
  const codeHash = (
    code: Hex | undefined,
    expected: Hex,
    error: string,
  ): void => {
    if (code === undefined || code === "0x" || keccak256(code) !== expected)
      throw new DeploymentIntegrityError(error);
  };
  codeHash(
    snapshot.proxyCode,
    manifest.erc8183.proxyCodeHash,
    "PROXY_CODE_HASH_MISMATCH",
  );
  codeHash(
    snapshot.implementationCode,
    manifest.erc8183.implementationCodeHash,
    "IMPLEMENTATION_CODE_HASH_MISMATCH",
  );
  codeHash(
    snapshot.evaluatorCode,
    manifest.pactEvaluator.codeHash,
    "EVALUATOR_CODE_HASH_MISMATCH",
  );
  if (snapshot.usdcCode === undefined || snapshot.usdcCode === "0x")
    throw new DeploymentIntegrityError("USDC_CODE_MISSING");
  if (snapshot.implementationSlot === undefined)
    throw new DeploymentIntegrityError("IMPLEMENTATION_SLOT_EMPTY");
  equalAddress(
    `0x${snapshot.implementationSlot.slice(-40)}`,
    manifest.erc8183.implementation,
    "IMPLEMENTATION_SLOT_MISMATCH",
  );
}

export async function verifyDeploymentIntegrity(
  rpcUrl: string,
  manifest: DeploymentManifest,
  timeoutMs = DEFAULT_ARC_RPC_TIMEOUT_MS,
): Promise<void> {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_ARC_RPC_TIMEOUT_MS
  )
    throw new DeploymentIntegrityError("ARC_RPC_TIMEOUT_INVALID");
  const client = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: timeoutMs }),
  });
  if (BigInt(await client.getChainId()) !== BigInt(manifest.chainId))
    throw new DeploymentIntegrityError("CHAIN_ID_MISMATCH");

  const [
    proxyCode,
    implementationCode,
    evaluatorCode,
    usdcCode,
    implementationSlot,
  ] = await Promise.all([
    client.getCode({ address: manifest.erc8183.proxy }),
    client.getCode({ address: manifest.erc8183.implementation }),
    client.getCode({ address: manifest.pactEvaluator.address }),
    client.getCode({ address: manifest.usdc.address }),
    client.getStorageAt({
      address: manifest.erc8183.proxy,
      slot: EIP1967_IMPLEMENTATION_SLOT,
    }),
  ]);
  assertDeploymentCodeSnapshot(manifest, {
    proxyCode,
    implementationCode,
    evaluatorCode,
    usdcCode,
    implementationSlot,
  });

  const read = async (
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args?: readonly unknown[],
  ): Promise<unknown> =>
    client.readContract({
      address,
      abi,
      functionName,
      ...(args === undefined ? {} : { args }),
    } as never);
  const [
    commerce,
    verifier,
    evaluatorAdmin,
    treasury,
    platformFee,
    evaluatorFee,
    paused,
    tokenAllowed,
    zeroHook,
    defaultAdmin,
    admin,
    decimals,
  ] = await Promise.all([
    read(
      manifest.pactEvaluator.address,
      evaluatorConfigurationAbi,
      "commerceContract",
    ),
    read(
      manifest.pactEvaluator.address,
      evaluatorConfigurationAbi,
      "defaultVerifier",
    ),
    read(manifest.pactEvaluator.address, evaluatorConfigurationAbi, "admin"),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "platformTreasury"),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "platformFeeBP"),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "evaluatorFeeBP"),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "paused"),
    read(
      manifest.erc8183.proxy,
      erc8183ConfigurationAbi,
      "allowedPaymentTokens",
      [manifest.usdc.address],
    ),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "whitelistedHooks", [
      "0x0000000000000000000000000000000000000000",
    ]),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "hasRole", [
      `0x${"00".repeat(32)}`,
      manifest.erc8183.defaultAdmin,
    ]),
    read(manifest.erc8183.proxy, erc8183ConfigurationAbi, "hasRole", [
      ERC8183_ADMIN_ROLE,
      manifest.erc8183.admin,
    ]),
    read(manifest.usdc.address, usdcAbi, "decimals"),
  ]);
  equalAddress(commerce, manifest.erc8183.proxy, "EVALUATOR_COMMERCE_MISMATCH");
  equalAddress(
    verifier,
    manifest.pactEvaluator.verifier,
    "EVALUATOR_VERIFIER_MISMATCH",
  );
  equalAddress(
    evaluatorAdmin,
    manifest.pactEvaluator.admin,
    "EVALUATOR_ADMIN_MISMATCH",
  );
  equalAddress(treasury, manifest.erc8183.treasury, "TREASURY_MISMATCH");
  if (platformFee !== 0n || evaluatorFee !== 0n)
    throw new DeploymentIntegrityError("NONZERO_FEE");
  if (paused !== false) throw new DeploymentIntegrityError("ERC8183_PAUSED");
  if (tokenAllowed !== true)
    throw new DeploymentIntegrityError("USDC_NOT_ALLOWED");
  if (zeroHook !== true)
    throw new DeploymentIntegrityError("ZERO_HOOK_NOT_ALLOWED");
  if (defaultAdmin !== true)
    throw new DeploymentIntegrityError("DEFAULT_ADMIN_MISSING");
  if (admin !== true) throw new DeploymentIntegrityError("ADMIN_MISSING");
  if (decimals !== 6)
    throw new DeploymentIntegrityError("USDC_DECIMALS_MISMATCH");
}
