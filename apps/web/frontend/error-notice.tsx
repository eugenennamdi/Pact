import { ProductApiFailure } from "./product-client";

const messages: Readonly<Record<string, string>> = {
  AUTH_REQUIRED:
    "Your session has expired. Sign in with the connected wallet again.",
  WRONG_WALLET: "The connected wallet is not authorized for this action.",
  WRONG_NETWORK: "Switch the wallet to Arc Testnet before continuing.",
  ACTION_NOT_READY: "This action is not ready in the canonical Pact state.",
  AWAITING_CONDITION: "The verified outcome is not available yet.",
  INSUFFICIENT_BALANCE: "The required balance is not available.",
  INSUFFICIENT_ALLOWANCE: "The required finite allowance is not available.",
  STALE_PREPARATION: "The prepared action is stale. Prepare it again.",
  RPC_TEMPORARY:
    "Arc RPC is temporarily unavailable or confirmation is pending.",
  GITHUB_TEMPORARY: "GitHub verification is temporarily unavailable.",
  NEEDS_ATTENTION: "Pact needs operator attention.",
  TERMINAL: "The request cannot be completed.",
  PREPARE_SIGNER_MISMATCH:
    "The prepared action requires a different wallet. No transaction was sent.",
  SESSION_WALLET_MISMATCH:
    "The authenticated session does not match the connected wallet.",
  PREPARE_WRONG_NETWORK:
    "The prepared action is not for Arc Testnet. No transaction was sent.",
  SIGNATURE_REJECTED: "The wallet signature request was rejected.",
  WALLET_ACCOUNT_UNAVAILABLE: "The wallet did not return an account.",
};

export function errorDescription(error: unknown): string {
  if (error instanceof ProductApiFailure) {
    const base =
      messages[error.category] ??
      messages.TERMINAL ??
      "The request cannot be completed.";
    return error.retryAfterSeconds === null
      ? `${base} (${error.code})`
      : `${base} Retry after ${error.retryAfterSeconds} seconds. (${error.code})`;
  }
  if (error instanceof Error) {
    const mapped = messages[error.message];
    if (mapped !== undefined) return mapped;
  }
  return "The request could not be completed.";
}

export function ErrorNotice({ error }: { readonly error: unknown }) {
  return (
    <p role="alert" className="error">
      {errorDescription(error)}
    </p>
  );
}
