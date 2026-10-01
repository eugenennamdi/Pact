import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAddress, isAddress, isHash, type Address, type Hex } from "viem";
import type { PactNetwork } from "./manifest.js";

export const controlledOperatorStages = [
  "DEPLOYED",
  "JOB_CREATED",
  "CONDITION_BOUND",
  "FUNDED",
  "SUBMITTED",
  "AWAITING_CONDITION",
  "CONDITION_SATISFIED",
  "PHASE4A_ENQUEUED",
  "READY_TO_RELAY",
  "SETTLED",
] as const;

export type ControlledOperatorStage = (typeof controlledOperatorStages)[number];
export type ControlledOperatorAction = "prepare" | "resume";

export interface AffordabilityAuditRecord {
  readonly step: string;
  readonly sender: Address;
  readonly blockNumber: string;
  readonly senderBalance: string;
  readonly observedGasPrice: string;
  readonly planningGasPrice: string;
  readonly gasRequirement: string;
  readonly applicationReserveBaseUnits: string;
  readonly totalRequirement: string;
}

export interface ControlledOperatorState {
  readonly schemaVersion: 2;
  readonly stage: ControlledOperatorStage;
  readonly manifestIdentity: Hex;
  readonly network: PactNetwork;
  readonly chainId: string;
  readonly operationScope: string;
  readonly pactId: string;
  readonly commerceContract: Address;
  readonly pactEvaluator: Address;
  readonly client: Address;
  readonly provider: Address;
  readonly verifier: Address;
  readonly relay: Address;
  readonly repository: string;
  readonly pullRequest: number;
  readonly baseBranch: string;
  readonly conditionHash: Hex;
  readonly amount: string;
  readonly clientBefore: string;
  readonly providerBefore: string;
  readonly escrowBefore: string;
  readonly treasuryBefore: string;
  readonly evaluatorBefore: string;
  readonly relayGasBefore: string;
  readonly completionDeadline: string;
  readonly expiredAt: string;
  readonly jobId?: string;
  readonly jobKey?: Hex;
  readonly transactions: Readonly<Record<string, Hex>>;
  readonly affordabilityChecks: readonly AffordabilityAuditRecord[];
  readonly initialConditionResult?: "NOT_SATISFIED_RETRYABLE";
  readonly falseResumeCount?: number;
  readonly operationId?: string;
  readonly settlementTransactionHash?: Hex;
}

export interface ControlledOperatorIdentity {
  readonly manifestIdentity: Hex;
  readonly network: PactNetwork;
  readonly chainId: string;
  readonly operationScope: string;
  readonly commerceContract: Address;
  readonly pactEvaluator: Address;
  readonly client: Address;
  readonly provider: Address;
  readonly verifier: Address;
  readonly relay: Address;
  readonly repository: string;
  readonly pullRequest: number;
  readonly baseBranch: string;
  readonly conditionHash: Hex;
  readonly amount: string;
}

const stageIndex = new Map(
  controlledOperatorStages.map((stage, index) => [stage, index]),
);

function integer(value: unknown, label: string, positive = false): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    (positive && value === "0")
  )
    throw new Error(`OPERATOR_STATE_INVALID:${label}`);
  return value;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: true }))
    throw new Error(`OPERATOR_STATE_INVALID:${label}`);
  return getAddress(value);
}

function hash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHash(value))
    throw new Error(`OPERATOR_STATE_INVALID:${label}`);
  return value as Hex;
}

export function parseControlledOperatorAction(
  value: string,
): ControlledOperatorAction {
  if (value !== "prepare" && value !== "resume")
    throw new Error("PACT_E2E_ACTION must be prepare or resume");
  return value;
}

export function assertControlledOperatorState(
  value: unknown,
): ControlledOperatorState {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("OPERATOR_STATE_INVALID:root");
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 2)
    throw new Error("OPERATOR_STATE_INVALID:schemaVersion");
  if (
    typeof state.stage !== "string" ||
    !stageIndex.has(state.stage as ControlledOperatorStage)
  )
    throw new Error("OPERATOR_STATE_INVALID:stage");
  if (state.network !== "arc-testnet" && state.network !== "arc-mainnet")
    throw new Error("OPERATOR_STATE_INVALID:network");
  for (const field of [
    "operationScope",
    "pactId",
    "repository",
    "baseBranch",
  ] as const) {
    if (typeof state[field] !== "string" || state[field].length === 0)
      throw new Error(`OPERATOR_STATE_INVALID:${field}`);
  }
  if (
    typeof state.pullRequest !== "number" ||
    !Number.isSafeInteger(state.pullRequest) ||
    state.pullRequest <= 0
  )
    throw new Error("OPERATOR_STATE_INVALID:pullRequest");
  hash(state.manifestIdentity, "manifestIdentity");
  hash(state.conditionHash, "conditionHash");
  for (const field of [
    "commerceContract",
    "pactEvaluator",
    "client",
    "provider",
    "verifier",
    "relay",
  ] as const)
    address(state[field], field);
  for (const field of [
    "chainId",
    "amount",
    "clientBefore",
    "providerBefore",
    "escrowBefore",
    "treasuryBefore",
    "evaluatorBefore",
    "relayGasBefore",
    "completionDeadline",
    "expiredAt",
  ] as const)
    integer(state[field], field);
  if (
    BigInt(state.completionDeadline as string) >=
    BigInt(state.expiredAt as string)
  )
    throw new Error("OPERATOR_STATE_INVALID:deadlineOrder");
  if (
    typeof state.transactions !== "object" ||
    state.transactions === null ||
    Array.isArray(state.transactions)
  )
    throw new Error("OPERATOR_STATE_INVALID:transactions");
  for (const transactionHash of Object.values(
    state.transactions as Record<string, unknown>,
  ))
    hash(transactionHash, "transactions");
  if (!Array.isArray(state.affordabilityChecks))
    throw new Error("OPERATOR_STATE_INVALID:affordabilityChecks");
  for (const [index, rawAudit] of state.affordabilityChecks.entries()) {
    if (
      typeof rawAudit !== "object" ||
      rawAudit === null ||
      Array.isArray(rawAudit)
    )
      throw new Error(`OPERATOR_STATE_INVALID:affordabilityChecks.${index}`);
    const audit = rawAudit as Record<string, unknown>;
    if (typeof audit.step !== "string" || audit.step.length === 0)
      throw new Error(
        `OPERATOR_STATE_INVALID:affordabilityChecks.${index}.step`,
      );
    address(audit.sender, `affordabilityChecks.${index}.sender`);
    for (const field of [
      "blockNumber",
      "senderBalance",
      "observedGasPrice",
      "planningGasPrice",
      "gasRequirement",
      "applicationReserveBaseUnits",
      "totalRequirement",
    ] as const)
      integer(audit[field], `affordabilityChecks.${index}.${field}`);
  }
  const stage = state.stage as ControlledOperatorStage;
  const atLeast = (minimum: ControlledOperatorStage) =>
    stageIndex.get(stage)! >= stageIndex.get(minimum)!;
  const transaction = (name: string) =>
    hash(
      (state.transactions as Record<string, unknown>)[name],
      `transactions.${name}`,
    );
  if (atLeast("JOB_CREATED")) {
    integer(state.jobId, "jobId", true);
    hash(state.jobKey, "jobKey");
    transaction("createJob");
  }
  if (atLeast("CONDITION_BOUND")) transaction("bindCondition");
  if (atLeast("FUNDED")) {
    transaction("setBudget");
    transaction("approveUsdc");
    transaction("fund");
  }
  if (atLeast("SUBMITTED")) transaction("submit");
  if (
    atLeast("AWAITING_CONDITION") &&
    state.initialConditionResult !== "NOT_SATISFIED_RETRYABLE"
  )
    throw new Error("OPERATOR_STATE_INVALID:initialConditionResult");
  if (atLeast("PHASE4A_ENQUEUED")) {
    if (typeof state.operationId !== "string" || state.operationId.length === 0)
      throw new Error("OPERATOR_STATE_INVALID:operationId");
  }
  if (atLeast("SETTLED"))
    hash(state.settlementTransactionHash, "settlementTransactionHash");
  return value as ControlledOperatorState;
}

function equalAddress(left: Address, right: Address): boolean {
  return getAddress(left) === getAddress(right);
}

export function assertControlledOperatorIdentity(
  state: ControlledOperatorState,
  expected: ControlledOperatorIdentity,
): void {
  const exact =
    state.manifestIdentity === expected.manifestIdentity &&
    state.network === expected.network &&
    state.chainId === expected.chainId &&
    state.operationScope === expected.operationScope &&
    state.repository === expected.repository &&
    state.pullRequest === expected.pullRequest &&
    state.baseBranch === expected.baseBranch &&
    state.conditionHash === expected.conditionHash &&
    state.amount === expected.amount;
  const addresses =
    equalAddress(state.commerceContract, expected.commerceContract) &&
    equalAddress(state.pactEvaluator, expected.pactEvaluator) &&
    equalAddress(state.client, expected.client) &&
    equalAddress(state.provider, expected.provider) &&
    equalAddress(state.verifier, expected.verifier) &&
    equalAddress(state.relay, expected.relay);
  if (!exact || !addresses)
    throw new Error("OPERATOR_RESUME_IDENTITY_MISMATCH");
}

export function advanceControlledOperatorState(
  state: ControlledOperatorState,
  nextStage: ControlledOperatorStage,
  patch: Partial<ControlledOperatorState> = {},
): ControlledOperatorState {
  const current = stageIndex.get(state.stage)!;
  const next = stageIndex.get(nextStage)!;
  if (next < current || next > current + 1)
    throw new Error("OPERATOR_STAGE_TRANSITION_INVALID");
  return assertControlledOperatorState({
    ...state,
    ...patch,
    stage: nextStage,
  });
}

export class FileControlledOperatorState {
  private constructor(private readonly path: string) {}

  static open(path: string): FileControlledOperatorState {
    return new FileControlledOperatorState(path);
  }

  static async acquireExclusive(path: string): Promise<() => Promise<void>> {
    const lockPath = `${path}.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
    } catch (error) {
      await handle?.close();
      if (error instanceof Error && /EEXIST/.test(error.message))
        throw new Error("OPERATOR_RUN_ALREADY_ACTIVE");
      throw error;
    }
    return async () => {
      await rm(lockPath, { force: true });
    };
  }

  async load(): Promise<ControlledOperatorState | undefined> {
    try {
      return assertControlledOperatorState(
        JSON.parse(await readFile(this.path, "utf8")) as unknown,
      );
    } catch (error) {
      if (error instanceof Error && /ENOENT/.test(error.message))
        return undefined;
      throw error;
    }
  }

  async create(state: ControlledOperatorState): Promise<void> {
    assertControlledOperatorState(state);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }

  async save(state: ControlledOperatorState): Promise<void> {
    assertControlledOperatorState(state);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
