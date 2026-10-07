import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveAnvilExecutable } from "./anvil-executable.js";

describe("portable Anvil executable resolution", () => {
  it("respects the Pact override before the generic override", () => {
    expect(
      resolveAnvilExecutable({
        PACT_ANVIL_BIN: "/test/pact-anvil",
        ANVIL_BIN: "/test/generic-anvil",
      }),
    ).toBe("/test/pact-anvil");
    expect(resolveAnvilExecutable({ ANVIL_BIN: "/test/generic-anvil" })).toBe(
      "/test/generic-anvil",
    );
  });

  it("defaults to PATH resolution", () => {
    expect(resolveAnvilExecutable({})).toBe("anvil");
    expect(resolveAnvilExecutable({ PACT_ANVIL_BIN: " ", ANVIL_BIN: "" })).toBe(
      "anvil",
    );
  });

  it("keeps executable E2E and test code free of a macOS absolute path", async () => {
    const forbiddenPath = [
      "",
      "Users",
      "apple",
      ".foundry",
      "bin",
      "anvil",
    ].join("/");
    const sources = await Promise.all(
      [
        "./local-e2e.ts",
        "../recovery.local-e2e.test.ts",
        "../relay/e2e.ts",
        "../../../product/src/wallet-lifecycle.local-e2e.test.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    for (const source of sources) {
      expect(source).not.toContain(forbiddenPath);
    }
  });
});
