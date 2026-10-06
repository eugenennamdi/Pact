import type { PactDatabase } from "@pact/database";
import { createPublicClient, http, type Address } from "viem";
import { AUTOMATION_CHAIN_ID } from "./config.js";

export const PROVEN_SETTLEMENT_GAS_UNITS = 166_071n;
export const RELAY_GAS_MARGIN_NUMERATOR = 110n;
export const RELAY_GAS_MARGIN_DENOMINATOR = 100n;

function client(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl, { timeout: 5_000 }) });
}

export async function probeDatabase(database: PactDatabase): Promise<void> {
  await database.sql`SELECT 1`;
}

export async function probeArcRpc(rpcUrl: string): Promise<void> {
  const chainId = BigInt(await client(rpcUrl).getChainId());
  if (chainId !== AUTOMATION_CHAIN_ID)
    throw new Error("AUTOMATION_TESTNET_CHAIN_REQUIRED");
}

export async function probeGithub(token?: string): Promise<void> {
  const response = await fetch("https://api.github.com/rate_limit", {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "pact-verifier-readiness",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("GITHUB_UNAVAILABLE");
  await response.body?.cancel();
}

export async function probeRelayBalance(input: {
  readonly rpcUrl: string;
  readonly relayAddress: Address;
}): Promise<Readonly<{ balance: bigint; required: bigint }>> {
  const publicClient = client(input.rpcUrl);
  const chainId = BigInt(await publicClient.getChainId());
  if (chainId !== AUTOMATION_CHAIN_ID)
    throw new Error("AUTOMATION_TESTNET_CHAIN_REQUIRED");
  const gas =
    (PROVEN_SETTLEMENT_GAS_UNITS * RELAY_GAS_MARGIN_NUMERATOR +
      RELAY_GAS_MARGIN_DENOMINATOR -
      1n) /
    RELAY_GAS_MARGIN_DENOMINATOR;
  const [balance, block] = await Promise.all([
    publicClient.getBalance({ address: input.relayAddress }),
    publicClient.getBlock(),
  ]);
  if (typeof block.baseFeePerGas === "bigint") {
    const fees = await publicClient.estimateFeesPerGas({
      chain: null,
      type: "eip1559",
    });
    return Object.freeze({ balance, required: gas * fees.maxFeePerGas });
  }
  const gasPrice = await publicClient.getGasPrice();
  return Object.freeze({ balance, required: gas * gasPrice });
}

export async function countBroadcastUnknown(
  database: PactDatabase,
): Promise<number> {
  const rows = await database.sql<{ readonly count: number }[]>`
    SELECT count(*)::int AS count
    FROM relay_intents
    WHERE state = 'BROADCAST_UNKNOWN'
  `;
  return rows[0]?.count ?? 0;
}
