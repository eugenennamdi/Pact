import type {
  PactDto,
  PublicWalletActionPath,
} from "../../../packages/product/src/public-contract";
import {
  DEFAULT_PRODUCT_NETWORK,
  type ProductNetworkConfig,
} from "../../../packages/product/src/network";

const actionPaths: Readonly<
  Record<
    Exclude<PactDto["nextRequiredAction"], "VERIFY" | "SETTLE" | "NONE">,
    PublicWalletActionPath
  >
> = {
  CREATE_JOB: "create-job",
  BIND_CONDITION: "bind-condition",
  SET_BUDGET: "set-budget",
  APPROVE_USDC: "approve-usdc",
  FUND: "fund",
  SUBMIT: "submit",
};

export type ActionDecision =
  | { readonly kind: "CONNECT" }
  | { readonly kind: "WRONG_NETWORK" }
  | { readonly kind: "AUTHENTICATE" }
  | { readonly kind: "WAITING_FOR_CLIENT" | "WAITING_FOR_PROVIDER" }
  | { readonly kind: "AUTOMATED" }
  | { readonly kind: "TERMINAL" }
  | {
      readonly kind: "READY";
      readonly action: PublicWalletActionPath;
      readonly label: string;
    };

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function decidePactAction(input: {
  readonly pact: PactDto;
  readonly walletAddress: string | null;
  readonly walletChainId: number | null;
  readonly authenticated: boolean;
  readonly network?: ProductNetworkConfig;
}): ActionDecision {
  const { pact } = input;
  const network = input.network ?? DEFAULT_PRODUCT_NETWORK;
  if (pact.chainId !== network.chainIdNumber) return { kind: "TERMINAL" };
  if (
    pact.nextRequiredAction === "VERIFY" ||
    pact.nextRequiredAction === "SETTLE"
  )
    return { kind: "AUTOMATED" };
  if (pact.nextRequiredAction === "NONE") return { kind: "TERMINAL" };
  if (input.walletAddress === null) return { kind: "CONNECT" };
  if (input.walletChainId !== network.chainIdNumber)
    return { kind: "WRONG_NETWORK" };
  const expected =
    pact.nextRequiredActor === "CLIENT" ? pact.client : pact.provider;
  if (!sameAddress(input.walletAddress, expected)) {
    return {
      kind:
        pact.nextRequiredActor === "CLIENT"
          ? "WAITING_FOR_CLIENT"
          : "WAITING_FOR_PROVIDER",
    };
  }
  if (!input.authenticated) return { kind: "AUTHENTICATE" };
  if (!(pact.nextRequiredAction in actionPaths)) return { kind: "TERMINAL" };
  const action = actionPaths[pact.nextRequiredAction];
  return {
    kind: "READY",
    action,
    label: pact.nextRequiredAction.replaceAll("_", " "),
  };
}

export function mayRetryVerification(
  pact: PactDto,
  walletAddress: string | null,
  authenticated: boolean,
): boolean {
  return (
    authenticated &&
    walletAddress !== null &&
    ["AWAITING_CONDITION", "VERIFYING"].includes(pact.status) &&
    (sameAddress(walletAddress, pact.client) ||
      sameAddress(walletAddress, pact.provider))
  );
}
