import { describe, expect, it } from "vitest";
import { assertRelayTransition, relayTransitions } from "./state.js";

describe("relay state machine", () => {
  it("crosses a one-way durable dispatch boundary", () => {
    expect(relayTransitions.SIGNED).toContain("DISPATCHING");
    expect(relayTransitions.DISPATCHING).not.toContain("SIGNED");
    expect(relayTransitions.DISPATCHING).toContain("BROADCAST_UNKNOWN");
  });

  it("makes BROADCAST_UNKNOWN read-only and never dispatchable", () => {
    expect(relayTransitions.BROADCAST_UNKNOWN).not.toContain("DISPATCHING");
    expect(relayTransitions.BROADCAST_UNKNOWN).not.toContain("SIGNED");
    expect(relayTransitions.BROADCAST_UNKNOWN).toContain("BROADCAST_UNKNOWN");
  });

  it("rejects invalid retries and terminal transitions", () => {
    expect(() => assertRelayTransition("DISPATCHING", "SIGNED")).toThrow(
      "invalid relay transition",
    );
    expect(() => assertRelayTransition("SETTLED", "PREPARING")).toThrow(
      "invalid relay transition",
    );
    expect(() =>
      assertRelayTransition("BROADCAST_UNKNOWN", "BROADCAST_UNKNOWN"),
    ).not.toThrow();
  });
});
