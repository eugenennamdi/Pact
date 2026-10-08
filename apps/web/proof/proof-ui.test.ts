import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getMainnetProof,
  getSettlementProof,
  mainnetJob1Proof,
  mainnetJob2Proof,
  selectProofEnvironment,
  testnetProof,
} from "./artifacts";

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
    expect(getSettlementProof(undefined)).toBe(mainnetJob2Proof);
    expect(getSettlementProof("mainnet")).toBe(mainnetJob2Proof);
    expect(getSettlementProof("testnet")).toBe(testnetProof);
  });

  it("keeps the proof route deterministic and free of persisted selection", async () => {
    const route = await source("../app/proof/page.tsx");
    expect(route).toContain("getSettlementProof(network)");
    expect(route).not.toMatch(/localStorage|sessionStorage|cookie/i);
  });

  it("keeps full canonical values behind copy and explorer affordances", async () => {
    const component = await source("../frontend/proof-center.tsx");
    const presentation = await source("../frontend/presentation.tsx");
    const styles = await source("../app/globals.css");
    expect(component).toContain("<HashDisplay hash={hash} />");
    expect(component).toContain("/tx/${hash}");
    expect(component).not.toContain("truncate={false}");
    expect(component).not.toMatch(/\.slice\([^)]*hash|truncateHex/);
    expect(presentation).toContain('className="tech-hash" aria-label={value}');
    expect(presentation).toContain("<CopyButton text={value}");
    expect(presentation).toContain('document.execCommand("copy")');
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("white-space: nowrap");
    expect(styles).toContain("width: 4.75rem");
  });

  it("preserves stable direct Mainnet job routes", async () => {
    const legacy = await source("../app/proof/arc-mainnet/job/1/page.tsx");
    const current = await source("../app/proof/arc-mainnet/job/2/page.tsx");
    expect(getMainnetProof("1")).toBe(mainnetJob1Proof);
    expect(getMainnetProof("2")).toBe(mainnetJob2Proof);
    expect(legacy).toContain('getMainnetProof("1")');
    expect(current).toContain('getMainnetProof("2")');
    expect(legacy).not.toContain("redirect");
    expect(current).not.toContain("redirect");
    expect(legacy).not.toContain("eth_sendTransaction");
    expect(current).not.toContain("eth_sendTransaction");
  });

  it("renders recovery lineage only when an artifact supplies it", async () => {
    const component = await source("../frontend/proof-center.tsx");
    expect(mainnetJob1Proof.recovery).toBeUndefined();
    expect(testnetProof.recovery).toBeUndefined();
    expect(mainnetJob2Proof.recovery).toBeDefined();
    expect(component).toContain("if (lineage === undefined) return null");
    expect(component).toContain("Recovery lineage");
    expect(component).toContain("Retired unsent");
  });
});
