import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  PactDto,
  PrepareActionDto,
} from "../../../packages/product/src/public-contract";
import { decidePactAction } from "./action-controller";
import { authenticateWallet, isBrowserSessionValid } from "./auth-flow";
import {
  createProductApiClient,
  publicWalletActionPaths,
} from "./product-client";
import {
  prepareActionForWallet,
  sendPreparedTransaction,
} from "./wallet-action";
import {
  ARC_TESTNET_CHAIN_ID,
  WalletDiscovery,
  connectWallet,
  type Eip1193Provider,
  type Eip1193RequestArguments,
  type WalletProviderInfo,
} from "./wallet";

const CLIENT = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const TARGET = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

class FakeProvider implements Eip1193Provider {
  readonly calls: Eip1193RequestArguments[] = [];
  readonly #handler: (arguments_: Eip1193RequestArguments) => unknown;

  constructor(handler: (arguments_: Eip1193RequestArguments) => unknown) {
    this.#handler = handler;
  }

  async request(arguments_: Eip1193RequestArguments): Promise<unknown> {
    this.calls.push(arguments_);
    return this.#handler(arguments_);
  }
}

class FakeDiscoveryTarget {
  readonly #listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.#listeners.get(event.type) ?? [])
      listener(event);
    return true;
  }

  announce(info: WalletProviderInfo, provider: Eip1193Provider): void {
    const event = { detail: { info, provider } } as unknown as Event;
    for (const listener of this.#listeners.get("eip6963:announceProvider") ??
      [])
      listener(event);
  }
}

const prepared: PrepareActionDto = {
  result: "PREPARED",
  replayed: false,
  action: "CREATE_JOB",
  chainId: ARC_TESTNET_CHAIN_ID,
  requiredSigner: CLIENT,
  to: TARGET,
  value: "15",
  data: "0x1234",
  calldataHash: HASH,
  preparationVersion: 1,
  preparedAtBlock: "10",
  preparedAtBlockHash: HASH,
  preparationExpiresAt: "2026-10-04T00:00:00.000Z",
  expectedStateTransition: "DRAFT_TO_OPEN_JOB",
  summary: "Create job",
  estimatedGas: "100000",
  fee: {
    gasPrice: "1",
    nativeBalance: "100",
    erc20BalanceBaseUnits: "100",
    requiredNativeBalance: "10",
    readiness: "READY",
    sharedUnderlyingBalance: true,
  },
  deadlines: { completionDeadline: "20", expiredAt: "30" },
};

function pact(overrides: Partial<PactDto> = {}): PactDto {
  return {
    slug: `pact_${"a".repeat(32)}`,
    network: "arc-testnet",
    chainId: ARC_TESTNET_CHAIN_ID,
    client: CLIENT,
    provider: PROVIDER,
    repository: "example/repository",
    pullRequest: 1,
    baseBranch: "main",
    event: "PR_MERGED",
    amountBaseUnits: "1000",
    conditionHash: HASH,
    jobId: null,
    jobKey: null,
    commerceAddress: TARGET,
    evaluatorAddress: TARGET,
    completionDeadline: null,
    expiry: null,
    status: "ACTION_REQUIRED",
    next: { actor: "CLIENT", action: "CREATE_JOB" },
    nextRequiredActor: "CLIENT",
    nextRequiredAction: "CREATE_JOB",
    canonicalJobStatus: null,
    walletActions: [],
    evidence: null,
    settlement: null,
    ...overrides,
  };
}

describe("browser wallet security boundary", () => {
  it("discovers providers passively without requesting accounts", async () => {
    const target = new FakeDiscoveryTarget();
    const provider = new FakeProvider(() => []);
    const discovery = new WalletDiscovery(target, provider);
    discovery.start();
    await Promise.resolve();
    expect(provider.calls).toEqual([]);
    expect(discovery.providers()).toHaveLength(1);
  });

  it("preserves explicit selection when multiple EIP-6963 providers exist", async () => {
    const target = new FakeDiscoveryTarget();
    const first = new FakeProvider(() => [CLIENT]);
    const second = new FakeProvider(({ method }) =>
      method === "eth_chainId" ? "0x4cef52" : [PROVIDER],
    );
    const discovery = new WalletDiscovery(target);
    discovery.start();
    target.announce(
      { uuid: "first", name: "First", icon: "data:first", rdns: "first.io" },
      first,
    );
    target.announce(
      {
        uuid: "second",
        name: "Second",
        icon: "data:second",
        rdns: "second.io",
      },
      second,
    );
    const selected = discovery
      .providers()
      .find((item) => item.info.uuid === "second");
    expect(selected).toBeDefined();
    await connectWallet(selected?.provider as Eip1193Provider);
    expect(first.calls).toEqual([]);
    expect(second.calls.map((call) => call.method)).toEqual([
      "eth_requestAccounts",
      "eth_chainId",
    ]);
  });

  it("prevents preparation on the wrong chain before calling the API", async () => {
    const prepareAction = vi.fn();
    await expect(
      prepareActionForWallet({
        client: { prepareAction },
        slug: `pact_${"a".repeat(32)}`,
        action: "create-job",
        idempotencyKey: "prepare:test-1",
        walletAddress: CLIENT,
        walletChainId: 5042,
      }),
    ).rejects.toThrow("WRONG_NETWORK");
    expect(prepareAction).not.toHaveBeenCalled();
  });

  it("invalidates authenticated UI state when the wallet account changes", () => {
    const session = {
      walletAddress: CLIENT,
      chainId: ARC_TESTNET_CHAIN_ID,
      expiresInSeconds: 900,
      expiresAt: 10_000,
    } as const;
    expect(
      isBrowserSessionValid(session, PROVIDER, ARC_TESTNET_CHAIN_ID, 1),
    ).toBe(false);
  });

  it("passes the server challenge to personal_sign byte-for-byte", async () => {
    const message = "server\nchallenge\nbytes";
    const signature = `0x${"12".repeat(65)}`;
    const provider = new FakeProvider(({ method }) =>
      method === "personal_sign" ? signature : undefined,
    );
    const createSession = vi.fn(async () => ({
      walletAddress: CLIENT,
      chainId: ARC_TESTNET_CHAIN_ID as 5_042_002,
      expiresInSeconds: 900,
    }));
    await authenticateWallet({
      client: {
        challenge: async () => ({
          message,
          walletAddress: CLIENT,
          domain: "localhost",
          uri: "http://localhost",
          chainId: ARC_TESTNET_CHAIN_ID,
          nonce: "abcdefghijklmnopqrstuvwx",
          issuedAt: "2026-10-04T00:00:00.000Z",
          expirationTime: "2026-10-04T00:05:00.000Z",
        }),
        createSession,
      },
      provider,
      address: CLIENT,
      chainId: ARC_TESTNET_CHAIN_ID,
      now: 1,
    });
    expect(provider.calls[0]).toEqual({
      method: "personal_sign",
      params: [message, CLIENT],
    });
    expect(createSession).toHaveBeenCalledWith(message, signature);
  });

  it("does not create a session after signature rejection", async () => {
    const createSession = vi.fn();
    const provider = new FakeProvider(() => {
      throw new Error("user rejected request");
    });
    await expect(
      authenticateWallet({
        client: {
          challenge: async () => ({
            message: "exact message",
            walletAddress: CLIENT,
            domain: "localhost",
            uri: "http://localhost",
            chainId: ARC_TESTNET_CHAIN_ID,
            nonce: "abcdefghijklmnopqrstuvwx",
            issuedAt: "2026-10-04T00:00:00.000Z",
            expirationTime: "2026-10-04T00:05:00.000Z",
          }),
          createSession,
        },
        provider,
        address: CLIENT,
        chainId: ARC_TESTNET_CHAIN_ID,
      }),
    ).rejects.toThrow("user rejected request");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("requires re-authentication when the in-memory session expires", () => {
    const session = {
      walletAddress: CLIENT,
      chainId: ARC_TESTNET_CHAIN_ID,
      expiresInSeconds: 1,
      expiresAt: 100,
    } as const;
    expect(
      isBrowserSessionValid(session, CLIENT, ARC_TESTNET_CHAIN_ID, 100),
    ).toBe(false);
  });

  it("rejects a prepare result for a different signer", async () => {
    await expect(
      prepareActionForWallet({
        client: { prepareAction: async () => prepared },
        slug: `pact_${"a".repeat(32)}`,
        action: "create-job",
        idempotencyKey: "prepare:test-2",
        walletAddress: PROVIDER,
        walletChainId: ARC_TESTNET_CHAIN_ID,
      }),
    ).rejects.toThrow("PREPARE_SIGNER_MISMATCH");
  });

  it("rejects a prepare result for a different chain", async () => {
    await expect(
      prepareActionForWallet({
        client: {
          prepareAction: async () => ({ ...prepared, chainId: 5042 }),
        },
        slug: `pact_${"a".repeat(32)}`,
        action: "create-job",
        idempotencyKey: "prepare:test-3",
        walletAddress: CLIENT,
        walletChainId: ARC_TESTNET_CHAIN_ID,
      }),
    ).rejects.toThrow("PREPARE_WRONG_NETWORK");
  });

  it("sends exactly the prepared target, value and calldata", async () => {
    const provider = new FakeProvider(() => `0x${"34".repeat(32)}`);
    await sendPreparedTransaction({
      provider,
      walletAddress: CLIENT,
      prepared,
    });
    expect(provider.calls).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: CLIENT,
            to: TARGET,
            value: "0xf",
            data: "0x1234",
          },
        ],
      },
    ]);
  });

  it("does not send a wallet transaction during preparation", async () => {
    const provider = new FakeProvider(() => `0x${"34".repeat(32)}`);
    await prepareActionForWallet({
      client: { prepareAction: async () => prepared },
      slug: `pact_${"a".repeat(32)}`,
      action: "create-job",
      idempotencyKey: "prepare:test-4",
      walletAddress: CLIENT,
      walletChainId: ARC_TESTNET_CHAIN_ID,
    });
    expect(provider.calls).toEqual([]);
  });

  it("posts only the wallet transaction hash for canonical confirmation", async () => {
    const requests: { readonly path: string; readonly body: string | null }[] =
      [];
    const client = createProductApiClient(async (input, init) => {
      requests.push({ path: String(input), body: String(init?.body ?? "") });
      return Response.json({
        replayed: false,
        action: "CREATE_JOB",
        transactionHash: `0x${"34".repeat(32)}`,
        confirmationStatus: "CONFIRMED",
        confirmedAtBlock: "1",
        jobId: "1",
        jobKey: HASH,
        canonicalJobStatus: 0,
        productStatus: "ACTION_REQUIRED",
      });
    });
    await client.confirmAction(
      `pact_${"a".repeat(32)}`,
      "create-job",
      `0x${"34".repeat(32)}`,
    );
    expect(requests[0]).toEqual({
      path: `/api/v1/pacts/pact_${"a".repeat(32)}/actions/create-job/confirm`,
      body: JSON.stringify({ transactionHash: `0x${"34".repeat(32)}` }),
    });
  });

  it("does not report canonical success when confirmation fails", async () => {
    const client = createProductApiClient(async () =>
      Response.json({ error: "TRANSACTION_PENDING" }, { status: 409 }),
    );
    await expect(
      client.confirmAction(
        `pact_${"a".repeat(32)}`,
        "create-job",
        `0x${"34".repeat(32)}`,
      ),
    ).rejects.toMatchObject({ code: "TRANSACTION_PENDING" });
  });

  it("gives the wrong actor no transaction CTA", () => {
    expect(
      decidePactAction({
        pact: pact(),
        walletAddress: PROVIDER,
        walletChainId: ARC_TESTNET_CHAIN_ID,
        authenticated: true,
      }),
    ).toEqual({ kind: "WAITING_FOR_CLIENT" });
  });

  it("exposes exactly the canonical six wallet actions", () => {
    expect(publicWalletActionPaths).toEqual([
      "create-job",
      "bind-condition",
      "set-budget",
      "approve-usdc",
      "fund",
      "submit",
    ]);
  });

  it.each(["set-provider", "reclaim", "arbitrary-action"])(
    "rejects unsupported frontend action %s",
    async (action) => {
      const fetchImplementation = vi.fn();
      const client = createProductApiClient(fetchImplementation);
      expect(() =>
        client.prepareAction(
          `pact_${"a".repeat(32)}`,
          action as never,
          "prepare:unsupported",
        ),
      ).toThrow("UNSUPPORTED_WALLET_ACTION");
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["SET_BUDGET", "PROVIDER", CLIENT, "WAITING_FOR_PROVIDER"],
    ["APPROVE_USDC", "CLIENT", PROVIDER, "WAITING_FOR_CLIENT"],
  ] as const)(
    "gives the wrong actor no CTA for %s",
    (action, actor, walletAddress, expected) => {
      expect(
        decidePactAction({
          pact: pact({
            next: { actor, action },
            nextRequiredActor: actor,
            nextRequiredAction: action,
          }),
          walletAddress,
          walletChainId: ARC_TESTNET_CHAIN_ID,
          authenticated: true,
        }),
      ).toEqual({ kind: expected });
    },
  );

  it("offers only the server-projected next action, blocking out-of-order CTAs", () => {
    expect(
      decidePactAction({
        pact: pact({
          next: { actor: "CLIENT", action: "BIND_CONDITION" },
          nextRequiredActor: "CLIENT",
          nextRequiredAction: "BIND_CONDITION",
        }),
        walletAddress: CLIENT,
        walletChainId: ARC_TESTNET_CHAIN_ID,
        authenticated: true,
      }),
    ).toEqual({
      kind: "READY",
      action: "bind-condition",
      label: "BIND CONDITION",
    });
  });

  it.each(["SET_PROVIDER", "RECLAIM", "MANUFACTURED_ACTION"])(
    "fails closed when a non-contract DTO action is presented: %s",
    (action) => {
      expect(
        decidePactAction({
          pact: pact({
            next: { actor: "CLIENT", action: action as never },
            nextRequiredActor: "CLIENT",
            nextRequiredAction: action as never,
          }),
          walletAddress: CLIENT,
          walletChainId: ARC_TESTNET_CHAIN_ID,
          authenticated: true,
        }),
      ).toEqual({ kind: "TERMINAL" });
    },
  );

  it("exposes no arbitrary transaction fields through prepare requests", async () => {
    const requests: RequestInit[] = [];
    const client = createProductApiClient(async (_input, init) => {
      requests.push(init ?? {});
      return Response.json(prepared);
    });
    await client.prepareAction(
      `pact_${"a".repeat(32)}`,
      "create-job",
      "prepare:test-5",
    );
    expect(requests[0]?.body).toBe("{}");
  });

  it("never offers an interactive action for Mainnet state", () => {
    expect(
      decidePactAction({
        pact: pact({ chainId: 5042 }),
        walletAddress: CLIENT,
        walletChainId: 5042,
        authenticated: true,
      }),
    ).toEqual({ kind: "TERMINAL" });
  });

  it("keeps server configuration identifiers out of client source", async () => {
    const root = join(process.cwd(), "apps/web/frontend");
    const files = (await readdir(root)).filter(
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
    const banned = [
      "PACT_SESSION_SECRET",
      "GITHUB_TOKEN",
      "PACT_VERIFIER_PRIVATE_KEY",
      "PACT_RELAY_PRIVATE_KEY",
      "DATABASE_URL",
      "OPERATOR_PRIVATE_KEY",
      "/server/",
      "packages/product/src/index",
      "process.env",
    ];
    for (const file of files) {
      const source = await readFile(join(root, file), "utf8");
      for (const token of banned) expect(source).not.toContain(token);
    }
  });

  it("keeps the Mainnet proof enhancement read-only", async () => {
    const source = await readFile(
      join(process.cwd(), "apps/web/frontend/mainnet-live-confirmation.tsx"),
      "utf8",
    );
    expect(source).not.toContain("eth_sendTransaction");
    expect(source).not.toContain("personal_sign");
    expect(source).not.toContain("wallet_switchEthereumChain");
  });
});
