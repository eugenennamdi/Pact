import type {
  AuthChallengeDto,
  AuthSessionDto,
  ConfirmActionDto,
  CreatePactRequestDto,
  CreatePactResponseDto,
  EvidenceDto,
  LogoutDto,
  PactDto,
  PrepareActionDto,
  PublicWalletActionPath,
  RetryVerificationDto,
  SettlementDto,
} from "../../../packages/product/src/public-contract";

export const publicWalletActionPaths = [
  "create-job",
  "bind-condition",
  "set-budget",
  "approve-usdc",
  "fund",
  "submit",
] as const satisfies readonly PublicWalletActionPath[];

export type FrontendErrorCategory =
  | "AUTH_REQUIRED"
  | "WRONG_WALLET"
  | "WRONG_NETWORK"
  | "ACTION_NOT_READY"
  | "AWAITING_CONDITION"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_ALLOWANCE"
  | "STALE_PREPARATION"
  | "RPC_TEMPORARY"
  | "GITHUB_TEMPORARY"
  | "NEEDS_ATTENTION"
  | "TERMINAL";

export class ProductApiFailure extends Error {
  readonly category: FrontendErrorCategory;
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    readonly category: FrontendErrorCategory;
    readonly code: string;
    readonly status: number;
    readonly retryAfterSeconds?: number | null;
  }) {
    super(input.code);
    this.name = "ProductApiFailure";
    this.category = input.category;
    this.code = input.code;
    this.status = input.status;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const SLUG_PATTERN = /^pact_[a-f0-9]{32}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function pactPath(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) throw new Error("INVALID_PACT_SLUG");
  return `/api/v1/pacts/${slug}`;
}

function actionPath(action: PublicWalletActionPath): string {
  if (!publicWalletActionPaths.includes(action)) {
    throw new Error("UNSUPPORTED_WALLET_ACTION");
  }
  return action;
}

function idempotency(value: string): string {
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }
  return value;
}

function category(code: string, status: number): FrontendErrorCategory {
  if (
    status === 401 ||
    [
      "INVALID_SESSION",
      "SESSION_EXPIRED",
      "CHALLENGE_EXPIRED",
      "NONCE_ALREADY_CONSUMED",
    ].includes(code)
  )
    return "AUTH_REQUIRED";
  if (
    status === 403 ||
    code.includes("NOT_AUTHORIZED") ||
    code.includes("SIGNER_MISMATCH")
  )
    return "WRONG_WALLET";
  if (code.includes("CHAIN") && !code.includes("RETRYABLE"))
    return "WRONG_NETWORK";
  if (code.includes("BALANCE") || code === "INSUFFICIENT_RELAY_GAS")
    return "INSUFFICIENT_BALANCE";
  if (code.includes("ALLOWANCE")) return "INSUFFICIENT_ALLOWANCE";
  if (
    code.includes("PREPARATION") ||
    code.includes("PREDATES") ||
    code.includes("REORG")
  )
    return "STALE_PREPARATION";
  if (code.includes("GITHUB") || code.includes("PULL_REQUEST_NOT_ELIGIBLE"))
    return "GITHUB_TEMPORARY";
  if (
    status === 503 ||
    code.includes("RPC") ||
    code.includes("CHAIN_READ_RETRYABLE") ||
    code.includes("TRANSACTION_PENDING")
  )
    return "RPC_TEMPORARY";
  if (code === "EVIDENCE_NOT_READY" || code === "SETTLEMENT_NOT_READY")
    return "AWAITING_CONDITION";
  if (status === 409 || code.includes("NOT_READY")) return "ACTION_NOT_READY";
  if (status >= 500) return "NEEDS_ATTENTION";
  return "TERMINAL";
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorCode(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return "UNEXPECTED_RESPONSE";
}

function mutationHeaders(key?: string): HeadersInit {
  return {
    "content-type": "application/json",
    ...(key === undefined ? {} : { "idempotency-key": idempotency(key) }),
  };
}

export interface ProductApiClient {
  challenge(walletAddress: string): Promise<AuthChallengeDto>;
  createSession(message: string, signature: string): Promise<AuthSessionDto>;
  logout(): Promise<LogoutDto>;
  createPact(
    request: CreatePactRequestDto,
    idempotencyKey: string,
  ): Promise<CreatePactResponseDto>;
  getPact(slug: string): Promise<PactDto>;
  prepareAction(
    slug: string,
    action: PublicWalletActionPath,
    idempotencyKey: string,
  ): Promise<PrepareActionDto>;
  confirmAction(
    slug: string,
    action: PublicWalletActionPath,
    transactionHash: string,
  ): Promise<ConfirmActionDto>;
  retryVerification(
    slug: string,
    idempotencyKey: string,
  ): Promise<RetryVerificationDto>;
  getEvidence(slug: string): Promise<EvidenceDto>;
  getSettlement(slug: string): Promise<SettlementDto>;
}

export function createProductApiClient(
  fetchImplementation: FetchLike = globalThis.fetch.bind(globalThis),
): ProductApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!path.startsWith("/api/v1/")) throw new Error("CROSS_ORIGIN_FORBIDDEN");
    const response = await fetchImplementation(path, {
      ...init,
      cache: "no-store",
      credentials: "include",
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const code = errorCode(body);
      const retryAfter = response.headers.get("retry-after");
      throw new ProductApiFailure({
        category: category(code, response.status),
        code,
        status: response.status,
        retryAfterSeconds:
          retryAfter !== null && /^\d+$/.test(retryAfter)
            ? Number(retryAfter)
            : null,
      });
    }
    if (typeof body !== "object" || body === null) {
      throw new ProductApiFailure({
        category: "NEEDS_ATTENTION",
        code: "UNEXPECTED_RESPONSE",
        status: response.status,
      });
    }
    return body as T;
  }

  return Object.freeze({
    challenge: (walletAddress: string) =>
      request<AuthChallengeDto>("/api/v1/auth/challenge", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ walletAddress }),
      }),
    createSession: (message: string, signature: string) =>
      request<AuthSessionDto>("/api/v1/auth/session", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ message, signature }),
      }),
    logout: () =>
      request<LogoutDto>("/api/v1/auth/session", { method: "DELETE" }),
    createPact: (createRequest: CreatePactRequestDto, idempotencyKey: string) =>
      request<CreatePactResponseDto>("/api/v1/pacts", {
        method: "POST",
        headers: mutationHeaders(idempotencyKey),
        body: JSON.stringify(createRequest),
      }),
    getPact: (slug: string) => request<PactDto>(pactPath(slug)),
    prepareAction: (
      slug: string,
      action: PublicWalletActionPath,
      idempotencyKey: string,
    ) =>
      request<PrepareActionDto>(
        `${pactPath(slug)}/actions/${actionPath(action)}/prepare`,
        {
          method: "POST",
          headers: mutationHeaders(idempotencyKey),
          body: "{}",
        },
      ),
    confirmAction: (
      slug: string,
      action: PublicWalletActionPath,
      transactionHash: string,
    ) =>
      request<ConfirmActionDto>(
        `${pactPath(slug)}/actions/${actionPath(action)}/confirm`,
        {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({ transactionHash }),
        },
      ),
    retryVerification: (slug: string, idempotencyKey: string) =>
      request<RetryVerificationDto>(`${pactPath(slug)}/retry`, {
        method: "POST",
        headers: mutationHeaders(idempotencyKey),
        body: "{}",
      }),
    getEvidence: (slug: string) =>
      request<EvidenceDto>(`${pactPath(slug)}/evidence`),
    getSettlement: (slug: string) =>
      request<SettlementDto>(`${pactPath(slug)}/settlement`),
  });
}
