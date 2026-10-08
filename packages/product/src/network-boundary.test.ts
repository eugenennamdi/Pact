import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const productionModules = [
  "packages/product/src/auth.ts",
  "packages/product/src/config.ts",
  "packages/product/src/service.ts",
  "packages/product/src/session.ts",
  "packages/product/src/wallet-chain.ts",
  "packages/product/src/wallet-lifecycle.ts",
  "apps/web/frontend/action-controller.ts",
  "apps/web/frontend/auth-flow.ts",
  "apps/web/frontend/create-pact.tsx",
  "apps/web/frontend/wallet-action.ts",
  "apps/web/frontend/wallet-boundary.tsx",
  "apps/web/frontend/wallet.ts",
  "apps/web/server/product-runtime.ts",
] as const;

describe("product network boundary", () => {
  it("keeps Testnet literals out of production product runtime modules", async () => {
    for (const path of productionModules) {
      const source = await readFile(resolve(process.cwd(), path), "utf8");
      expect(source, path).not.toMatch(/5042002|5_042_002|arc-testnet/);
    }
  });
});
