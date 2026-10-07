export const PROOF_SCHEMA_VERSION = 1 as const;

export const proofEnvironments = ["mainnet", "testnet"] as const;
export type ProofEnvironment = (typeof proofEnvironments)[number];

export const lifecycleOrder = [
  "CREATE_JOB",
  "BIND_CONDITION",
  "SET_BUDGET",
  "APPROVE_USDC",
  "FUND",
  "SUBMIT",
] as const;

export interface ProofTransaction {
  readonly action: (typeof lifecycleOrder)[number];
  readonly label: string;
  readonly category: "WALLET_ACTION";
  readonly role: "CLIENT" | "PROVIDER";
  readonly txHash: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionIndex: number;
  readonly timestamp: string;
  readonly from: string;
  readonly to: string;
  readonly nonce: number;
  readonly value: string;
  readonly gasUsed: string;
  readonly effectiveGasPrice: string;
  readonly gasCost: string;
  readonly selector: string;
  readonly method: string;
  readonly arguments: Readonly<Record<string, string>>;
  readonly receiptStatus: "SUCCESS";
  readonly canonicalEvent: {
    readonly name: string;
    readonly logIndex: number;
  };
}

export interface SettlementProofArtifact {
  readonly schemaVersion: typeof PROOF_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly immutable: true;
  readonly network: "arc-mainnet" | "arc-testnet";
  readonly environment: ProofEnvironment;
  readonly chainId: number;
  readonly explorerBaseUrl: string;
  readonly slug: string | null;
  readonly contracts: {
    readonly implementation: string;
    readonly commerce: string;
    readonly pactEvaluator: string;
    readonly usdc: string;
  };
  readonly actors: {
    readonly client: string;
    readonly provider: string;
    readonly verifier: string;
    readonly relay: string;
    readonly treasury: string;
  };
  readonly job: {
    readonly id: string;
    readonly jobKey: string;
    readonly status: "COMPLETED";
    readonly description: string;
  };
  readonly condition: {
    readonly schemaVersion: 1;
    readonly provider: "github";
    readonly repository: string;
    readonly pullRequest: number;
    readonly baseBranch: string;
    readonly event: "PR_MERGED";
  };
  readonly conditionHash: string;
  readonly budget: {
    readonly baseUnits: string;
    readonly decimals: 6;
    readonly display: string;
    readonly token: string;
  };
  readonly deadlines: {
    readonly preparedTimestamp: string | null;
    readonly completionDeadline: string;
    readonly expiry: string;
  };
  readonly walletActions: readonly ProofTransaction[];
  readonly githubEvidence: {
    readonly schemaVersion: 1;
    readonly repository: string;
    readonly pullRequest: number;
    readonly baseBranch: string;
    readonly mergeCommitSha: string;
    readonly mergedAt: string;
    readonly observedAt: string;
  };
  readonly evidenceHash: string;
  readonly attestation: {
    readonly commerceContract: string;
    readonly jobId: string;
    readonly conditionHash: string;
    readonly evidenceHash: string;
    readonly satisfiedAt: string;
    readonly verifiedAt: string;
    readonly validUntil: string;
    readonly verifier: string;
    readonly signature: string;
    readonly digest: string;
    readonly recoveredSigner: string;
    readonly valid: true;
  };
  readonly relay: {
    readonly transactionHash: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly transactionIndex: number;
    readonly timestamp: string;
    readonly from: string;
    readonly to: string;
    readonly nonce: number;
    readonly value: string;
    readonly selector: string;
    readonly method: "completeWithAttestation";
    readonly gasUsed: string;
    readonly effectiveGasPrice: string;
    readonly gasCost: string;
    readonly receiptStatus: "SUCCESS";
    readonly pactCompletionAcceptedLogIndex: number;
    readonly jobCompletedLogIndex: number;
    readonly paymentReleasedLogIndex: number;
    readonly broadcastCount: 1;
    readonly broadcastUnknownCount: 0;
  };
  readonly settlement: {
    readonly outcome: "COMPLETED";
    readonly finalJobStatus: 3;
    readonly bindingAccepted: true;
    readonly settledAmount: string;
    readonly providerPayout: string;
    readonly treasuryPayout: "0";
    readonly evaluatorPayout: "0";
    readonly completionReason: string;
    readonly nextActor: "NONE";
    readonly nextAction: "NONE";
  };
  readonly accounting: {
    readonly principal: string;
    readonly clientBeforeFund: string;
    readonly escrowBeforeFund: string;
    readonly clientAfterFund: string;
    readonly escrowAfterFund: string;
    readonly providerBeforeComplete: string;
    readonly providerAfterComplete: string;
    readonly escrowAfterComplete: string;
    readonly residualAllowance: "0";
    readonly gasUnit: "ARC_NATIVE_18_DECIMALS";
  };
  readonly sourceProvenance: {
    readonly proofSourceCommit: string;
    readonly deploymentCommit: string;
    readonly runtimeCommit: string;
    readonly erc8183SourceCommit: string;
    readonly certifiedEvidenceCheckpoint: string | null;
  };
}

const HEX_32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
const COMMIT = /^(?:0x)?[0-9a-f]{40}$/;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  for (const key of keys) {
    if (!(key in record)) throw new Error(`${label}.${key} is required`);
  }
}

function requirePattern(value: unknown, pattern: RegExp, label: string): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

export function validateSettlementProofArtifact(
  input: unknown,
): SettlementProofArtifact {
  const root = requireRecord(input, "proof");
  requireKeys(
    root,
    [
      "schemaVersion",
      "artifactId",
      "immutable",
      "network",
      "environment",
      "chainId",
      "contracts",
      "actors",
      "job",
      "condition",
      "conditionHash",
      "budget",
      "deadlines",
      "walletActions",
      "githubEvidence",
      "evidenceHash",
      "attestation",
      "relay",
      "settlement",
      "accounting",
      "sourceProvenance",
    ],
    "proof",
  );
  if (root.schemaVersion !== PROOF_SCHEMA_VERSION || root.immutable !== true) {
    throw new Error("proof schema or immutability marker is invalid");
  }
  if (
    (root.environment !== "mainnet" && root.environment !== "testnet") ||
    (root.network !== "arc-mainnet" && root.network !== "arc-testnet") ||
    !Number.isSafeInteger(root.chainId)
  ) {
    throw new Error("proof network identity is invalid");
  }

  const contracts = requireRecord(root.contracts, "proof.contracts");
  const actors = requireRecord(root.actors, "proof.actors");
  for (const [key, value] of Object.entries({ ...contracts, ...actors })) {
    requirePattern(value, ADDRESS, `proof address ${key}`);
  }
  requirePattern(root.conditionHash, HEX_32, "proof.conditionHash");
  requirePattern(root.evidenceHash, HEX_32, "proof.evidenceHash");

  if (!Array.isArray(root.walletActions) || root.walletActions.length !== 6) {
    throw new Error("proof must contain exactly six wallet actions");
  }
  const actions = root.walletActions.map((item, index) => {
    const action = requireRecord(item, `proof.walletActions[${index}]`);
    requirePattern(action.txHash, HEX_32, `wallet action ${index} txHash`);
    requirePattern(
      action.blockHash,
      HEX_32,
      `wallet action ${index} blockHash`,
    );
    requirePattern(action.from, ADDRESS, `wallet action ${index} from`);
    requirePattern(action.to, ADDRESS, `wallet action ${index} to`);
    return action.action;
  });
  if (actions.some((action, index) => action !== lifecycleOrder[index])) {
    throw new Error("proof wallet actions are out of canonical order");
  }

  const evidence = requireRecord(root.githubEvidence, "proof.githubEvidence");
  requirePattern(evidence.mergeCommitSha, COMMIT, "merge commit SHA");
  const attestation = requireRecord(root.attestation, "proof.attestation");
  requirePattern(attestation.signature, SIGNATURE, "attestation signature");
  requirePattern(attestation.digest, HEX_32, "attestation digest");
  requirePattern(attestation.recoveredSigner, ADDRESS, "recovered signer");
  if (
    attestation.conditionHash !== root.conditionHash ||
    attestation.evidenceHash !== root.evidenceHash ||
    attestation.valid !== true
  ) {
    throw new Error("attestation commitment mismatch");
  }
  const relay = requireRecord(root.relay, "proof.relay");
  requirePattern(relay.transactionHash, HEX_32, "relay transaction hash");
  if (relay.broadcastCount !== 1 || relay.broadcastUnknownCount !== 0) {
    throw new Error("relay broadcast identity is invalid");
  }

  const source = requireRecord(root.sourceProvenance, "proof.sourceProvenance");
  for (const key of [
    "proofSourceCommit",
    "deploymentCommit",
    "runtimeCommit",
    "erc8183SourceCommit",
  ]) {
    requirePattern(source[key], COMMIT, `sourceProvenance.${key}`);
  }
  return input as SettlementProofArtifact;
}

export function assertPublicProofDto(
  artifact: SettlementProofArtifact,
): SettlementProofArtifact {
  const serialized = JSON.stringify(artifact).toLowerCase();
  for (const forbidden of [
    "privatekey",
    "private_key",
    "mnemonic",
    "database_url",
    "github_token",
    "rpc_url",
    "session_secret",
    "rawtransaction",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`proof contains forbidden secret field: ${forbidden}`);
    }
  }
  return artifact;
}
