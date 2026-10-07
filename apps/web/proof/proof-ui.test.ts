import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectProofEnvironment } from "./artifacts";

const pathFromHere = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

async function source(relative: string): Promise<string> {
  return readFile(pathFromHere(relative), "utf8");
}

describe("proof selection and route contract", () => {
  it("defaults every fresh selection to Mainnet", () => {
    expect(selectProofEnvironment(undefined)).toBe("mainnet");
    expect(selectProofEnvironment("testnet")).toBe("testnet");
    expect(selectProofEnvironment(undefined)).toBe("mainnet");
    expect(selectProofEnvironment("mainnet")).toBe("mainnet");
    expect(selectProofEnvironment("malformed")).toBe("mainnet");
  });

  it("keeps the proof route deterministic and free of persisted selection", async () => {
    const route = await source("../app/proof/page.tsx");
    expect(route).toContain("getSettlementProof(network)");
    expect(route).not.toMatch(/localStorage|sessionStorage|cookie/i);
  });

  it("keeps full canonical values behind copy and explorer affordances", async () => {
    const component = await source("../frontend/proof-center.tsx");
    expect(component).toContain("<HashDisplay hash={hash} />");
    expect(component).toContain("/tx/${hash}");
    expect(component).toContain("truncate={false}");
    expect(component).not.toMatch(/\.slice\([^)]*hash|truncateHex/);
  });

  it("preserves the legacy Mainnet proof URL with an intentional redirect", async () => {
    const legacy = await source("../app/proof/arc-mainnet/job/1/page.tsx");
    expect(legacy).toContain('redirect("/proof?network=mainnet")');
    expect(legacy).not.toContain("eth_sendTransaction");
  });
});
