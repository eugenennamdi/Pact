import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPLETION_DEADLINE_POLICY,
  DEADLINE_ANCHOR_EXPLANATION,
  formatResolvedDeadline,
  MAXIMUM_LIFETIME_POLICY,
} from "./deadline-copy";

describe("deadline presentation semantics", () => {
  it("describes both Testnet deadlines from the job-preparation anchor", () => {
    expect(COMPLETION_DEADLINE_POLICY).toBe("2 hours from job preparation");
    expect(MAXIMUM_LIFETIME_POLICY).toBe(
      "6 hours maximum lifetime from job preparation",
    );
    expect(DEADLINE_ANCHOR_EXPLANATION).toBe(
      "Pact derives both deadlines from the Arc block timestamp used when the CREATE_JOB transaction is prepared.",
    );
  });

  it("shows relative policy before preparation and the resolved local time afterward", () => {
    expect(formatResolvedDeadline(null, COMPLETION_DEADLINE_POLICY)).toBe(
      COMPLETION_DEADLINE_POLICY,
    );

    const value = "1791298646";
    expect(formatResolvedDeadline(value, COMPLETION_DEADLINE_POLICY)).toBe(
      `${new Date(Number(value) * 1_000).toLocaleString()} (${COMPLETION_DEADLINE_POLICY})`,
    );
    expect(formatResolvedDeadline(value, MAXIMUM_LIFETIME_POLICY)).toBe(
      `${new Date(Number(value) * 1_000).toLocaleString()} (${MAXIMUM_LIFETIME_POLICY})`,
    );
  });

  it("keeps active product UI free of funding-anchored deadline claims", async () => {
    const frontend = join(process.cwd(), "apps/web/frontend");
    const files = (await readdir(frontend, { recursive: true })).filter(
      (file) =>
        /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file),
    );
    const content = (
      await Promise.all(
        files.map((file) => readFile(join(frontend, file), "utf8")),
      )
    ).join("\n");

    expect(content).not.toMatch(/after funding/i);
    expect(content).not.toMatch(/from funding/i);
    expect(content).not.toMatch(/once (?:the )?escrow is funded/i);
    expect(content).toContain(COMPLETION_DEADLINE_POLICY);
    expect(content).toContain(MAXIMUM_LIFETIME_POLICY);
  });
});
