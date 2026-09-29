import { keccak256, type Hex } from "viem";

export type DeploymentTransactionState =
  | "PREPARED"
  | "DISPATCHING"
  | "SUBMITTED"
  | "BROADCAST_UNKNOWN"
  | "CONFIRMED"
  | "REVERTED";

export interface DeploymentTransactionRecord {
  readonly step: string;
  readonly state: DeploymentTransactionState;
  readonly transactionHash: Hex;
  readonly serializedTransaction: Hex;
  readonly nonce: number;
  readonly receiptBlock?: bigint;
}

export interface DeploymentJournal {
  load(step: string): Promise<DeploymentTransactionRecord | undefined>;
  save(record: DeploymentTransactionRecord): Promise<void>;
}

export interface PreparedDeploymentTransaction {
  readonly serializedTransaction: Hex;
  readonly nonce: number;
}

export type DeploymentReceiptObservation =
  | { readonly status: "PENDING" }
  | { readonly status: "SUCCESS"; readonly blockNumber: bigint }
  | { readonly status: "REVERTED"; readonly blockNumber: bigint };

export interface DeploymentTransactionExecutorOptions {
  readonly step: string;
  readonly journal: DeploymentJournal;
  prepare(): Promise<PreparedDeploymentTransaction>;
  broadcast(serializedTransaction: Hex): Promise<Hex>;
  observe(transactionHash: Hex): Promise<DeploymentReceiptObservation>;
}

async function reconcile(
  record: DeploymentTransactionRecord,
  options: DeploymentTransactionExecutorOptions,
): Promise<DeploymentTransactionRecord> {
  const observation = await options.observe(record.transactionHash);
  if (observation.status === "PENDING") return record;
  const next: DeploymentTransactionRecord = {
    ...record,
    state: observation.status === "SUCCESS" ? "CONFIRMED" : "REVERTED",
    receiptBlock: observation.blockNumber,
  };
  await options.journal.save(next);
  return next;
}

/**
 * Persists the exact signed transaction before dispatch. Once DISPATCHING is durable,
 * an uncertain call is observation-only forever; callers must never blindly re-send.
 */
export async function executeDeploymentTransaction(
  options: DeploymentTransactionExecutorOptions,
): Promise<DeploymentTransactionRecord> {
  let record = await options.journal.load(options.step);
  if (record?.state === "CONFIRMED" || record?.state === "REVERTED")
    return record;
  if (
    record?.state === "DISPATCHING" ||
    record?.state === "SUBMITTED" ||
    record?.state === "BROADCAST_UNKNOWN"
  )
    return reconcile(record, options);

  if (record === undefined) {
    const prepared = await options.prepare();
    record = {
      step: options.step,
      state: "PREPARED",
      transactionHash: keccak256(prepared.serializedTransaction),
      serializedTransaction: prepared.serializedTransaction,
      nonce: prepared.nonce,
    };
    await options.journal.save(record);
  }

  record = { ...record, state: "DISPATCHING" };
  await options.journal.save(record);
  try {
    const returnedHash = await options.broadcast(record.serializedTransaction);
    record = {
      ...record,
      state:
        returnedHash.toLowerCase() === record.transactionHash.toLowerCase()
          ? "SUBMITTED"
          : "BROADCAST_UNKNOWN",
    };
  } catch {
    record = { ...record, state: "BROADCAST_UNKNOWN" };
  }
  await options.journal.save(record);
  return reconcile(record, options);
}
