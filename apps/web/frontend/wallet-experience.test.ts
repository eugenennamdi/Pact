import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decidePactAction } from "./action-controller";
import type { PactDto } from "../../../packages/product/src/public-contract";
import { ARC_TESTNET_CHAIN_ID } from "./wallet";
import {
  safeWalletIcon,
  truncateWalletAddress,
  walletErrorMessage,
} from "./wallet-ui";

const CLIENT = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const TARGET = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

function pact(): PactDto {
  return {
    slug: `pact_${"a".repeat(32)}`,
    network: "arc-testnet",
    chainId: ARC_TESTNET_CHAIN_ID,
    client: CLIENT,
    provider: PROVIDER,
    repository: "example/repository",
    pullRequest: 1,
    baseBranch: "main",
    event: "PR_MERGED",
    amountBaseUnits: "1000",
    conditionHash: HASH,
    jobId: null,
    jobKey: null,
    commerceAddress: TARGET,
    evaluatorAddress: TARGET,
    completionDeadline: null,
    expiry: null,
    status: "ACTION_REQUIRED",
    next: { actor: "CLIENT", action: "CREATE_JOB" },
    nextRequiredActor: "CLIENT",
    nextRequiredAction: "CREATE_JOB",
    canonicalJobStatus: null,
    walletActions: [],
    evidence: null,
    settlement: null,
  };
}

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), "apps/web", path), "utf8");
}

describe("standard wallet experience", () => {
  it("removes the native provider select and developer wallet card", async () => {
    const boundary = await source("frontend/wallet-boundary.tsx");
    expect(boundary).not.toContain("<select");
    expect(boundary).not.toContain("Wallet provider");
    expect(boundary).not.toContain("wallet-panel");
    expect(boundary).not.toContain("Session status");
    expect(boundary).not.toContain("Signature challenge required");
  });

  it("places the single primary Connect wallet entry point in the header", async () => {
    const boundary = await source("frontend/wallet-boundary.tsx");
    const headerControl = boundary.slice(
      boundary.indexOf("export function WalletHeaderControl"),
      boundary.indexOf("export function WalletRequirement"),
    );
    expect(headerControl.match(/Connect wallet/g)).toHaveLength(1);
    expect(await source("app/layout.tsx")).toContain("<WalletHeaderControl />");
  });

  it("opens an accessible native dialog with keyboard-selectable provider rows", async () => {
    const boundary = await source("frontend/wallet-boundary.tsx");
    expect(boundary).toContain("<dialog");
    expect(boundary).toContain("showModal()");
    expect(boundary).toContain("onCancel={onClose}");
    expect(boundary).toContain("aria-labelledby={titleId}");
    expect(boundary).toContain('className="wallet-provider-row"');
    expect(boundary).toContain("onClick={() => void connectProvider");
  });

  it("uses actual discovery metadata and a clear no-wallet state", async () => {
    const boundary = await source("frontend/wallet-boundary.tsx");
    expect(boundary).toContain("providers.map");
    expect(boundary).toContain("item.info.name");
    expect(boundary).toContain("item.info.rdns");
    expect(boundary).toContain("No browser wallet detected.");
  });

  it("accepts only bounded raster data URLs for provider icons", () => {
    expect(safeWalletIcon("data:image/png;base64,YWJjZA==")).toBe(
      "data:image/png;base64,YWJjZA==",
    );
    expect(
      safeWalletIcon(
        "data:image/svg+xml,<svg onload='globalThis.compromised=true'/>",
      ),
    ).toBeNull();
    expect(safeWalletIcon("https://wallet.example/icon.png")).toBeNull();
  });

  it("renders the connected account as a compact address", () => {
    expect(truncateWalletAddress(CLIENT)).toBe("0x1111…1111");
  });

  it("provides account, copy, network, sign-in, switch, and disconnect controls", async () => {
    const boundary = await source("frontend/wallet-boundary.tsx");
    expect(boundary).toContain(".writeText(address)");
    expect(boundary).toContain('"Copy address"');
    expect(boundary).toContain("Switch to Arc Testnet");
    expect(boundary).toContain("Sign in to Pact");
    expect(boundary).toContain("Disconnect");
    expect(boundary).toContain("setAccountDialogOpen(false)");
  });

  it("keeps connection distinct from Pact authentication", () => {
    expect(
      decidePactAction({
        pact: pact(),
        walletAddress: CLIENT,
        walletChainId: ARC_TESTNET_CHAIN_ID,
        authenticated: false,
      }),
    ).toEqual({ kind: "AUTHENTICATE" });
  });

  it("blocks preparation on the wrong network and offers an explicit switch", () => {
    expect(
      decidePactAction({
        pact: pact(),
        walletAddress: CLIENT,
        walletChainId: 1,
        authenticated: true,
      }),
    ).toEqual({ kind: "WRONG_NETWORK" });
  });

  it("maps cancellations and failures to concise copy without raw errors", () => {
    expect(walletErrorMessage({ code: 4001 }, "connect")).toBe(
      "Connection cancelled",
    );
    expect(walletErrorMessage(new Error("user rejected"), "sign-in")).toBe(
      "Sign-in cancelled",
    );
    expect(walletErrorMessage(new Error("RPC secret detail"), "connect")).toBe(
      "Could not connect wallet. Try again.",
    );
    expect(
      walletErrorMessage(new Error("WALLET_ACCOUNT_UNAVAILABLE"), "connect"),
    ).toBe("Wallet is no longer available");
  });

  it("keeps create and detail pages free of duplicate wallet management panels", async () => {
    const create = await source("frontend/create-pact.tsx");
    const detail = await source("frontend/pact-detail.tsx");
    for (const content of [create, detail]) {
      expect(content).not.toContain("WalletControls");
      expect(content).not.toContain("wallet-panel");
    }
    expect(create).toContain("<WalletRequirement />");
  });

  it("keeps the Mainnet proof route read-only and wallet-optional", async () => {
    const proof = await source("app/proof/arc-mainnet/job/1/page.tsx");
    expect(proof).not.toContain("useWallet");
    expect(proof).not.toContain("WalletRequirement");
    expect(proof).not.toContain("eth_sendTransaction");
    expect(proof).not.toContain("wallet_switchEthereumChain");
  });
});
