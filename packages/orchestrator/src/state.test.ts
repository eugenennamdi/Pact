import { describe, expect, it } from "vitest";
import { assertAllowedTransition, operationTransitions } from "./state.js";

describe("Phase 4A durable state machine", () => {
  it("allows only the documented happy-path transitions", () => {
    const path = [
      "PENDING",
      "VERIFYING_GITHUB",
      "VERIFIED",
      "RECONCILING_CHAIN",
      "READY_TO_SIGN",
      "SIGNING",
      "READY_TO_RELAY",
    ] as const;
    for (let index = 0; index < path.length - 1; index++) {
      expect(() =>
        assertAllowedTransition(path[index]!, path[index + 1]!),
      ).not.toThrow();
    }
  });

  it("makes terminal and READY_TO_RELAY states terminal", () => {
    for (const state of [
      "NOT_SATISFIED_RETRYABLE",
      "NOT_SATISFIED_TERMINAL",
      "INDETERMINATE",
      "CHAIN_RETRYABLE",
      "CHAIN_INVALID",
      "READY_TO_RELAY",
      "ALREADY_ACCEPTED",
      "EXPIRED",
      "FAILED_DEFINITE",
    ] as const) {
      expect(operationTransitions[state]).toEqual([]);
    }
  });

  it("rejects signing before chain reconciliation", () => {
    expect(() => assertAllowedTransition("VERIFIED", "SIGNING")).toThrow(
      "invalid operation transition",
    );
    expect(() =>
      assertAllowedTransition("PENDING", "READY_TO_RELAY"),
    ).toThrow();
  });
});
