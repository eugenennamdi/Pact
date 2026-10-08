import { describe, expect, it } from "vitest";
import { ARC_MAINNET_PRODUCT_NETWORK } from "../../../packages/product/src/network";
import {
  switchToProductNetwork,
  type Eip1193Provider,
  type Eip1193RequestArguments,
} from "./wallet";

class RecordingProvider implements Eip1193Provider {
  readonly calls: Eip1193RequestArguments[] = [];

  constructor(private readonly missingChain = false) {}

  async request(input: Eip1193RequestArguments): Promise<unknown> {
    this.calls.push(input);
    if (this.missingChain && input.method === "wallet_switchEthereumChain") {
      throw Object.assign(new Error("unknown chain"), { code: 4902 });
    }
    return null;
  }
}

describe("product wallet network projection", () => {
  it("requests the Arc Mainnet chain by default", async () => {
    const provider = new RecordingProvider();
    await switchToProductNetwork(provider);
    expect(provider.calls).toEqual([
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x13b2" }],
      },
    ]);
  });

  it("adds Arc Mainnet with reviewed public metadata when absent", async () => {
    const provider = new RecordingProvider(true);
    await switchToProductNetwork(provider, ARC_MAINNET_PRODUCT_NETWORK);
    expect(provider.calls[1]).toEqual({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x13b2",
          chainName: "Arc Mainnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: ["https://rpc.mainnet.arc.io"],
        },
      ],
    });
  });
});
