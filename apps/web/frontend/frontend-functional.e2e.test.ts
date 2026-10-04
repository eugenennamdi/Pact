import { describe, expect, it } from "vitest";
import type {
  CreatePactResponseDto,
  EvidenceDto,
  PactDto,
  PrepareActionDto,
  PublicWalletActionPath,
  SettlementDto,
} from "../../../packages/product/src/public-contract";
import { authenticateWallet } from "./auth-flow";
import { createProductApiClient } from "./product-client";
import {
  confirmWalletTransaction,
  prepareActionForWallet,
  sendPreparedTransaction,
} from "./wallet-action";
import {
  ARC_TESTNET_CHAIN_ID,
  connectWallet,
  type Eip1193Provider,
  type Eip1193RequestArguments,
} from "./wallet";

const CLIENT = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const COMMERCE = "0x3333333333333333333333333333333333333333" as const;
const EVALUATOR = "0x4444444444444444444444444444444444444444" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const SLUG = `pact_${"a".repeat(32)}`;
const actions = [
  "create-job",
  "bind-condition",
  "set-budget",
  "approve-usdc",
  "fund",
  "submit",
] as const satisfies readonly PublicWalletActionPath[];

const kinds = [
  "CREATE_JOB",
  "BIND_CONDITION",
  "SET_BUDGET",
  "APPROVE_USDC",
  "FUND",
  "SUBMIT",
] as const;

function signer(action: PublicWalletActionPath) {
  return action === "set-budget" || action === "submit" ? PROVIDER : CLIENT;
}

class ProductWallet implements Eip1193Provider {
  readonly address: `0x${string}`;
  readonly sent: Eip1193RequestArguments[] = [];
  #nonce = 1;

  constructor(address: `0x${string}`) {
    this.address = address;
  }

  async request(arguments_: Eip1193RequestArguments): Promise<unknown> {
    if (arguments_.method === "eth_requestAccounts") return [this.address];
    if (arguments_.method === "eth_chainId") return "0x4cef52";
    if (arguments_.method === "personal_sign") return `0x${"12".repeat(65)}`;
    if (arguments_.method === "eth_sendTransaction") {
      this.sent.push(arguments_);
      const nonce = this.#nonce;
      this.#nonce += 1;
      return `0x${nonce.toString(16).padStart(64, "0")}`;
    }
    throw new Error(`unexpected wallet method ${arguments_.method}`);
  }
}

function pact(status: PactDto["status"]): PactDto {
  const automated = ["AWAITING_CONDITION", "VERIFYING"].includes(status);
  return {
    slug: SLUG,
    network: "arc-testnet",
    chainId: ARC_TESTNET_CHAIN_ID,
    client: CLIENT,
    provider: PROVIDER,
    repository: "example/repository",
    pullRequest: 7,
    baseBranch: "main",
    event: "PR_MERGED",
    amountBaseUnits: "1000",
    conditionHash: HASH,
    jobId: "1",
    jobKey: HASH,
    commerceAddress: COMMERCE,
    evaluatorAddress: EVALUATOR,
    completionDeadline: "2000000000",
    expiry: "2000010000",
    status,
    next: automated
      ? { actor: "PACT", action: "VERIFY" }
      : { actor: "NONE", action: "NONE" },
    nextRequiredActor: automated ? "PACT" : "NONE",
    nextRequiredAction: automated ? "VERIFY" : "NONE",
    canonicalJobStatus: status === "COMPLETED" ? 3 : 2,
    walletActions: kinds.map((action, index) => ({
      action,
      requiredSigner: signer(actions[index] ?? "create-job"),
      confirmationStatus: "CONFIRMED",
      transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      preparedAtBlock: String(index + 1),
      preparationExpiresAt: "2026-10-04T00:05:00.000Z",
    })),
    evidence: status === "COMPLETED" ? evidence : null,
    settlement: status === "COMPLETED" ? settlement : null,
  };
}

const evidence: EvidenceDto = {
  conditionHash: HASH,
  evidenceHash: `0x${"cd".repeat(32)}`,
  repository: "example/repository",
  pullRequest: 7,
  baseBranch: "main",
  mergeCommitSha: `0x${"ef".repeat(20)}`,
  mergedAt: "1791074000",
  observedAt: "1791074010",
  attestationDigest: `0x${"56".repeat(32)}`,
  verifier: EVALUATOR,
  satisfiedAt: "1791074000",
  verifiedAt: "1791074011",
  validUntil: "1791074611",
};

const settlement: SettlementDto = {
  jobId: "1",
  jobKey: HASH,
  chainId: ARC_TESTNET_CHAIN_ID,
  commerce: COMMERCE,
  evaluator: EVALUATOR,
  transactionHash: `0x${"78".repeat(32)}`,
  state: "SETTLED",
  receiptBlockNumber: "10",
  receiptBlockHash: HASH,
  receiptTransactionIndex: 1,
  eventBlockNumber: "10",
  eventBlockHash: HASH,
  eventLogIndex: 2,
  finalJobStatus: 3,
  bindingAccepted: true,
  broadcastAttemptCount: 1,
  grossBudget: "1000",
  grossProviderPayout: "1000",
  treasuryApplicationPayout: "0",
  evaluatorApplicationPayout: "0",
  evidenceHash: evidence.evidenceHash,
  completionReason: evidence.evidenceHash,
};

describe("frontend functional product integration", () => {
  it("completes CREATE_JOB, BIND_CONDITION, SET_BUDGET, APPROVE_USDC, FUND, and SUBMIT before automatic settlement", async () => {
    let confirmedActions = 0;
    let publicRead = 0;
    const requests: string[] = [];
    const preparedActions: string[] = [];
    const sentActions: string[] = [];
    const confirmedActionKinds: string[] = [];
    const fetchImplementation = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/v1/auth/challenge") {
        const body = JSON.parse(String(init?.body)) as {
          readonly walletAddress: `0x${string}`;
        };
        return Response.json({
          message: `challenge for ${body.walletAddress}`,
          walletAddress: body.walletAddress,
          domain: "localhost",
          uri: "http://localhost",
          chainId: ARC_TESTNET_CHAIN_ID,
          nonce: "abcdefghijklmnopqrstuvwx",
          issuedAt: "2026-10-04T00:00:00.000Z",
          expirationTime: "2026-10-04T00:05:00.000Z",
        });
      }
      if (path === "/api/v1/auth/session") {
        const body = JSON.parse(String(init?.body)) as {
          readonly message: string;
        };
        const walletAddress = body.message.endsWith(CLIENT) ? CLIENT : PROVIDER;
        return Response.json({
          walletAddress,
          chainId: ARC_TESTNET_CHAIN_ID,
          expiresInSeconds: 900,
        });
      }
      if (path === "/api/v1/pacts" && init?.method === "POST") {
        const response: CreatePactResponseDto = {
          replayed: false,
          publicSlug: SLUG,
          network: "arc-testnet",
          chainId: ARC_TESTNET_CHAIN_ID,
          repository: "example/repository",
          pullRequest: 7,
          baseBranch: "main",
          event: "PR_MERGED",
          client: CLIENT,
          provider: PROVIDER,
          amountBaseUnits: "1000",
          condition: {
            schemaVersion: 1,
            provider: "github",
            repository: "example/repository",
            pullRequest: 7,
            baseBranch: "main",
            event: "PR_MERGED",
          },
          conditionHash: HASH,
          deadlinePolicy: {
            completionVersion: 1,
            completionOffsetSeconds: 7200,
            expiryVersion: 1,
            expiryOffsetSeconds: 21600,
          },
          commerceAddress: COMMERCE,
          evaluatorAddress: EVALUATOR,
          draftStatus: "DRAFT",
          next: { actor: "CLIENT", action: "CREATE_JOB" },
        };
        return Response.json(response, { status: 201 });
      }
      const prepareMatch = /\/actions\/([^/]+)\/prepare$/.exec(path);
      if (prepareMatch !== null) {
        const action = prepareMatch[1] as PublicWalletActionPath;
        preparedActions.push(action);
        const result: PrepareActionDto = {
          result: "PREPARED",
          replayed: false,
          action: kinds[actions.indexOf(action)] ?? "CREATE_JOB",
          chainId: ARC_TESTNET_CHAIN_ID,
          requiredSigner: signer(action),
          to: COMMERCE,
          value: "0",
          data: `0x${(actions.indexOf(action) + 1).toString(16).padStart(2, "0")}`,
          calldataHash: HASH,
          preparationVersion: 1,
          preparedAtBlock: "1",
          preparedAtBlockHash: HASH,
          preparationExpiresAt: "2026-10-04T00:05:00.000Z",
          expectedStateTransition: `TRANSITION_${action}`,
          summary: `Prepare ${action}`,
          estimatedGas: "100000",
          fee: {
            gasPrice: "1",
            nativeBalance: "100",
            erc20BalanceBaseUnits: "1000",
            requiredNativeBalance: "1",
            readiness: "READY",
            sharedUnderlyingBalance: true,
          },
          deadlines: null,
        };
        return Response.json(result, { status: 201 });
      }
      if (/\/actions\/[^/]+\/confirm$/.test(path)) {
        const action = kinds[confirmedActions] ?? "SUBMIT";
        confirmedActionKinds.push(action);
        confirmedActions += 1;
        return Response.json({
          replayed: false,
          action,
          transactionHash: `0x${confirmedActions.toString(16).padStart(64, "0")}`,
          confirmationStatus: "CONFIRMED",
          confirmedAtBlock: String(confirmedActions),
          jobId: "1",
          jobKey: HASH,
          canonicalJobStatus: action === "SUBMIT" ? 2 : 0,
          productStatus:
            action === "SUBMIT" ? "AWAITING_CONDITION" : "ACTION_REQUIRED",
        });
      }
      if (path === `/api/v1/pacts/${SLUG}`) {
        const states = [
          "AWAITING_CONDITION",
          "VERIFYING",
          "SETTLING",
          "COMPLETED",
        ] as const;
        const status =
          states[Math.min(publicRead++, states.length - 1)] ?? "COMPLETED";
        return Response.json(pact(status));
      }
      if (path.endsWith("/evidence")) return Response.json(evidence);
      if (path.endsWith("/settlement")) return Response.json(settlement);
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    };

    const api = createProductApiClient(fetchImplementation);
    const clientWallet = new ProductWallet(CLIENT);
    const providerWallet = new ProductWallet(PROVIDER);
    const clientConnection = await connectWallet(clientWallet);
    expect(clientConnection).toEqual({
      address: CLIENT,
      chainId: ARC_TESTNET_CHAIN_ID,
    });
    await authenticateWallet({
      client: api,
      provider: clientWallet,
      ...clientConnection,
    });
    const draft = await api.createPact(
      {
        repository: "example/repository",
        pullRequest: 7,
        provider: PROVIDER,
        amount: "0.001",
      },
      "create:functional-e2e",
    );
    expect(draft.publicSlug).toBe(SLUG);

    for (const action of actions) {
      const wallet = signer(action) === CLIENT ? clientWallet : providerWallet;
      const connection = await connectWallet(wallet);
      await authenticateWallet({
        client: api,
        provider: wallet,
        ...connection,
      });
      const beforeSend = wallet.sent.length;
      const prepared = await prepareActionForWallet({
        client: api,
        slug: SLUG,
        action,
        idempotencyKey: `prepare:${action}`,
        walletAddress: connection.address,
        walletChainId: connection.chainId,
      });
      expect(wallet.sent).toHaveLength(beforeSend);
      const transactionHash = await sendPreparedTransaction({
        provider: wallet,
        walletAddress: connection.address,
        prepared,
      });
      sentActions.push(action);
      const confirmation = await confirmWalletTransaction({
        client: api,
        slug: SLUG,
        action,
        transactionHash,
      });
      expect(confirmation.confirmationStatus).toBe("CONFIRMED");
    }
    expect(confirmedActions).toBe(6);
    expect(preparedActions).toEqual(actions);
    expect(sentActions).toEqual(actions);
    expect(confirmedActionKinds).toEqual(kinds);
    await expect(api.getPact(SLUG)).resolves.toMatchObject({
      status: "AWAITING_CONDITION",
    });
    await expect(api.getPact(SLUG)).resolves.toMatchObject({
      status: "VERIFYING",
    });
    await expect(api.getPact(SLUG)).resolves.toMatchObject({
      status: "SETTLING",
    });
    await expect(api.getPact(SLUG)).resolves.toMatchObject({
      status: "COMPLETED",
    });
    await expect(api.getEvidence(SLUG)).resolves.toEqual(evidence);
    await expect(api.getSettlement(SLUG)).resolves.toEqual(settlement);
    expect(requests.every((path) => path.startsWith("/api/v1/"))).toBe(true);
  });
});
