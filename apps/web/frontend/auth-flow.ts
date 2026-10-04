import type { AuthSessionDto } from "../../../packages/product/src/public-contract";
import type { ProductApiClient } from "./product-client";
import { ARC_TESTNET_CHAIN_ID, type Eip1193Provider } from "./wallet";

export interface BrowserAuthState extends AuthSessionDto {
  readonly expiresAt: number;
}

export async function authenticateWallet(input: {
  readonly client: Pick<ProductApiClient, "challenge" | "createSession">;
  readonly provider: Eip1193Provider;
  readonly address: `0x${string}`;
  readonly chainId: number;
  readonly now?: number;
}): Promise<BrowserAuthState> {
  if (input.chainId !== ARC_TESTNET_CHAIN_ID) throw new Error("WRONG_NETWORK");
  const challenge = await input.client.challenge(input.address);
  if (
    challenge.walletAddress.toLowerCase() !== input.address.toLowerCase() ||
    challenge.chainId !== ARC_TESTNET_CHAIN_ID
  ) {
    throw new Error("CHALLENGE_BINDING_MISMATCH");
  }
  const signature = await input.provider.request({
    method: "personal_sign",
    params: [challenge.message, input.address],
  });
  if (typeof signature !== "string") throw new Error("SIGNATURE_REJECTED");
  const session = await input.client.createSession(
    challenge.message,
    signature,
  );
  if (session.walletAddress.toLowerCase() !== input.address.toLowerCase()) {
    throw new Error("SESSION_WALLET_MISMATCH");
  }
  const now = input.now ?? Date.now();
  return Object.freeze({
    ...session,
    expiresAt: now + session.expiresInSeconds * 1_000,
  });
}

export function isBrowserSessionValid(
  session: BrowserAuthState | null,
  walletAddress: string | null,
  chainId: number | null,
  now = Date.now(),
): boolean {
  return (
    session !== null &&
    walletAddress !== null &&
    session.walletAddress.toLowerCase() === walletAddress.toLowerCase() &&
    session.chainId === ARC_TESTNET_CHAIN_ID &&
    chainId === ARC_TESTNET_CHAIN_ID &&
    session.expiresAt > now
  );
}
