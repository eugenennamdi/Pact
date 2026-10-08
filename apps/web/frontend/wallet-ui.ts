import { PRODUCT_WALLET_NETWORK } from "./wallet";

export type WalletRequestKind = "connect" | "sign-in" | "switch-network";

function isCancellation(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (Number(error.code) === 4001) return true;
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return ["reject", "denied", "cancel", "4001"].some((word) =>
    message.includes(word),
  );
}

export function walletErrorMessage(
  error: unknown,
  request: WalletRequestKind,
): string {
  if (error instanceof Error && error.message === "WRONG_NETWORK") {
    return `Switch to ${PRODUCT_WALLET_NETWORK.displayName} to continue`;
  }
  if (
    error instanceof Error &&
    ["WALLET_ACCOUNT_UNAVAILABLE", "WALLET_PROVIDER_UNAVAILABLE"].includes(
      error.message,
    )
  ) {
    return "Wallet is no longer available";
  }
  if (isCancellation(error)) {
    if (request === "connect") return "Connection cancelled";
    if (request === "sign-in") return "Sign-in cancelled";
    return "Request cancelled";
  }
  if (request === "connect") return "Could not connect wallet. Try again.";
  if (request === "sign-in") return "Could not sign in. Try again.";
  return "Could not switch network. Try again.";
}

export function truncateWalletAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function safeWalletIcon(icon: string): string | null {
  if (icon.length > 100_000) return null;
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(icon)
    ? icon
    : null;
}
