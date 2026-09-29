import { describe, expect, it, vi } from "vitest";
import { keccak256, type Hex } from "viem";
import {
  executeDeploymentTransaction,
  type DeploymentJournal,
  type DeploymentTransactionRecord,
} from "./transaction.js";

const raw = "0x01" as Hex;
const expectedHash = keccak256(raw);

function memoryJournal(initial?: DeploymentTransactionRecord): {
  journal: DeploymentJournal;
  records: DeploymentTransactionRecord[];
} {
  const records = initial === undefined ? [] : [initial];
  return {
    records,
    journal: {
      load: async () => records.at(-1),
      save: async (record) => void records.push(record),
    },
  };
}

describe("deployment transaction executor", () => {
  it("persists before dispatch and confirms a normal send", async () => {
    const { journal, records } = memoryJournal();
    const result = await executeDeploymentTransaction({
      step: "implementation",
      journal,
      prepare: async () => ({ serializedTransaction: raw, nonce: 7 }),
      broadcast: async () => expectedHash,
      observe: async () => ({ status: "SUCCESS", blockNumber: 11n }),
    });
    expect(records.map((entry) => entry.state)).toEqual([
      "PREPARED",
      "DISPATCHING",
      "SUBMITTED",
      "CONFIRMED",
    ]);
    expect(result.receiptBlock).toBe(11n);
  });

  it("treats a send timeout as unknown and later reconciles without resend", async () => {
    const { journal } = memoryJournal();
    const broadcast = vi.fn(async () => {
      throw new Error("timeout");
    });
    let found = false;
    const options = {
      step: "proxy",
      journal,
      prepare: async () => ({ serializedTransaction: raw, nonce: 8 }),
      broadcast,
      observe: async () =>
        found
          ? ({ status: "SUCCESS", blockNumber: 12n } as const)
          : ({ status: "PENDING" } as const),
    };
    expect((await executeDeploymentTransaction(options)).state).toBe(
      "BROADCAST_UNKNOWN",
    );
    found = true;
    expect((await executeDeploymentTransaction(options)).state).toBe(
      "CONFIRMED",
    );
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("never sends a transaction found in durable DISPATCHING state", async () => {
    const { journal } = memoryJournal({
      step: "allow-usdc",
      state: "DISPATCHING",
      transactionHash: expectedHash,
      serializedTransaction: raw,
      nonce: 9,
    });
    const broadcast = vi.fn(async () => expectedHash);
    const result = await executeDeploymentTransaction({
      step: "allow-usdc",
      journal,
      prepare: async () => ({ serializedTransaction: raw, nonce: 9 }),
      broadcast,
      observe: async () => ({ status: "PENDING" }),
    });
    expect(result.state).toBe("DISPATCHING");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("quarantines an RPC response with the wrong transaction hash", async () => {
    const { journal } = memoryJournal();
    const result = await executeDeploymentTransaction({
      step: "evaluator",
      journal,
      prepare: async () => ({ serializedTransaction: raw, nonce: 10 }),
      broadcast: async () => `0x${"ff".repeat(32)}`,
      observe: async () => ({ status: "PENDING" }),
    });
    expect(result.state).toBe("BROADCAST_UNKNOWN");
  });
});
