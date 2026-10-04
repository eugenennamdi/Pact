import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { isAddress } from "viem";
import {
  issueChallenge,
  verifyChallenge,
  type RecoverMessageAddress,
} from "./auth";
import type { ProductConfig } from "./config";
import type { CanonicalPactRegistrar } from "./canonical-link";
import type { RateLimiter, RateLimitScope } from "./rate-limit";
import {
  clearSessionCookie,
  createSessionToken,
  serializeSessionCookie,
  sessionTokenFromCookie,
  verifySessionToken,
} from "./session";
import {
  ProductError,
  createDraft,
  readPublicEvidence,
  readPublicPact,
  readPublicSettlement,
  type CreateDraftRequest,
  validateIdempotencyKey,
} from "./service";
import type { ProductAutomationRepository, ProductRepository } from "./types";
import type { ProductChainClient } from "./wallet-chain";
import { confirmWalletAction, prepareWalletAction } from "./wallet-lifecycle";

const BODY_LIMIT_BYTES = 4_096;

export interface ProductRuntime {
  readonly config: ProductConfig;
  readonly repository: ProductRepository;
  readonly github: GitHubPullRequestClient;
  readonly rateLimiter: RateLimiter;
  readonly recoverAddress?: RecoverMessageAddress;
  readonly chain?: ProductChainClient;
  readonly registrar?: CanonicalPactRegistrar;
  readonly automation?: ProductAutomationRepository;
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ProductError)
    return json({ error: error.code }, error.status);
  if (error instanceof Error) {
    const known: Readonly<Record<string, number>> = {
      INVALID_SESSION: 401,
      SESSION_EXPIRED: 401,
      INVALID_SIGNATURE: 400,
      INVALID_CHALLENGE_MESSAGE: 400,
      NON_CANONICAL_CHALLENGE_MESSAGE: 400,
      INVALID_CHALLENGE_TIME: 400,
      CHALLENGE_BINDING_MISMATCH: 401,
      CHALLENGE_EXPIRED: 401,
      CHALLENGE_ISSUED_IN_FUTURE: 401,
      NONCE_NOT_FOUND: 401,
      NONCE_ALREADY_CONSUMED: 401,
      SIGNER_MISMATCH: 401,
      INVALID_WALLET: 400,
      INVALID_ORIGIN: 403,
      UNSUPPORTED_CONTENT_TYPE: 415,
      BODY_TOO_LARGE: 413,
      MALFORMED_JSON: 400,
      INVALID_REQUEST: 400,
      TRANSACTION_ALREADY_CLAIMED: 409,
      TRANSACTION_CONFIRMATION_CONFLICT: 409,
    };
    const status = known[error.message];
    if (status !== undefined) return json({ error: error.message }, status);
  }
  return json({ error: "INTERNAL_ERROR" }, 500);
}

function requireWalletRuntime(runtime: ProductRuntime): {
  readonly chain: ProductChainClient;
  readonly registrar: CanonicalPactRegistrar;
} {
  if (runtime.chain === undefined || runtime.registrar === undefined)
    throw new Error("WALLET_RUNTIME_UNAVAILABLE");
  return { chain: runtime.chain, registrar: runtime.registrar };
}

function remoteKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "local"
  );
}

function applyRateLimit(
  runtime: ProductRuntime,
  request: Request,
  scope: RateLimitScope,
  suffix = "",
): Response | undefined {
  const decision = runtime.rateLimiter.consume(
    scope,
    `${remoteKey(request)}:${suffix}`,
  );
  return decision.allowed
    ? undefined
    : json({ error: "RATE_LIMITED" }, 429, {
        "retry-after": decision.retryAfterSeconds.toString(),
      });
}

function requireOrigin(request: Request, config: ProductConfig): void {
  if (request.headers.get("origin") !== config.publicOrigin.origin) {
    throw new Error("INVALID_ORIGIN");
  }
}

async function parseStrictJson(
  request: Request,
  allowedKeys: readonly string[],
): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) > BODY_LIMIT_BYTES
  ) {
    throw new Error("BODY_TOO_LARGE");
  }
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > BODY_LIMIT_BYTES) throw new Error("BODY_TOO_LARGE");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("MALFORMED_JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("INVALID_REQUEST");
  }
  const record = raw as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...allowedKeys].sort();
  if (actual.join(",") !== expected.join(","))
    throw new Error("INVALID_REQUEST");
  return record;
}

function requireSession(request: Request, config: ProductConfig) {
  const token = sessionTokenFromCookie(request.headers.get("cookie"));
  if (token === undefined) throw new Error("INVALID_SESSION");
  return verifySessionToken({ token, secret: config.sessionSecret });
}

export async function handleAuthChallenge(
  request: Request,
  runtime: ProductRuntime,
): Promise<Response> {
  try {
    requireOrigin(request, runtime.config);
    const limited = applyRateLimit(runtime, request, "AUTH_CHALLENGE");
    if (limited !== undefined) return limited;
    const body = await parseStrictJson(request, ["walletAddress"]);
    if (
      typeof body.walletAddress !== "string" ||
      !isAddress(body.walletAddress)
    )
      throw new Error("INVALID_WALLET");
    const challenge = await issueChallenge({
      repository: runtime.repository,
      walletAddress: body.walletAddress,
      publicOrigin: runtime.config.publicOrigin,
    });
    return json(challenge, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAuthSession(
  request: Request,
  runtime: ProductRuntime,
): Promise<Response> {
  try {
    requireOrigin(request, runtime.config);
    const limited = applyRateLimit(runtime, request, "AUTH_SESSION");
    if (limited !== undefined) return limited;
    const body = await parseStrictJson(request, ["message", "signature"]);
    if (
      typeof body.message !== "string" ||
      typeof body.signature !== "string"
    ) {
      throw new Error("INVALID_REQUEST");
    }
    const walletAddress = await verifyChallenge({
      repository: runtime.repository,
      publicOrigin: runtime.config.publicOrigin,
      message: body.message,
      signature: body.signature,
      ...(runtime.recoverAddress === undefined
        ? {}
        : { recoverAddress: runtime.recoverAddress }),
    });
    const token = createSessionToken({
      walletAddress,
      secret: runtime.config.sessionSecret,
      ttlSeconds: runtime.config.sessionTtlSeconds,
    });
    return json(
      {
        walletAddress,
        chainId: runtime.config.chainId,
        expiresInSeconds: runtime.config.sessionTtlSeconds,
      },
      201,
      {
        "set-cookie": serializeSessionCookie(
          token,
          runtime.config.secureCookie,
        ),
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleAuthLogout(
  request: Request,
  runtime: ProductRuntime,
): Response {
  try {
    requireOrigin(request, runtime.config);
    return json({ loggedOut: true }, 200, {
      "set-cookie": clearSessionCookie(runtime.config.secureCookie),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCreateDraft(
  request: Request,
  runtime: ProductRuntime,
): Promise<Response> {
  try {
    requireOrigin(request, runtime.config);
    const session = requireSession(request, runtime.config);
    const limited = applyRateLimit(
      runtime,
      request,
      "DRAFT_CREATE",
      session.walletAddress,
    );
    if (limited !== undefined) return limited;
    const body = await parseStrictJson(request, [
      "repository",
      "pullRequest",
      "provider",
      "amount",
    ]);
    if (
      typeof body.repository !== "string" ||
      typeof body.pullRequest !== "number" ||
      typeof body.provider !== "string" ||
      typeof body.amount !== "string"
    ) {
      throw new Error("INVALID_REQUEST");
    }
    const result = await createDraft({
      repository: runtime.repository,
      github: runtime.github,
      sessionWallet: session.walletAddress,
      idempotencyKey: request.headers.get("idempotency-key"),
      request: body as unknown as CreateDraftRequest,
    });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleReadPact(
  request: Request,
  runtime: ProductRuntime,
  slug: string,
): Promise<Response> {
  const limited = applyRateLimit(runtime, request, "PUBLIC_READ", slug);
  if (limited !== undefined) return limited;
  try {
    return json(await readPublicPact({ repository: runtime.repository, slug }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleReadEvidence(
  request: Request,
  runtime: ProductRuntime,
  slug: string,
): Promise<Response> {
  const limited = applyRateLimit(runtime, request, "PUBLIC_READ", slug);
  if (limited !== undefined) return limited;
  try {
    return json(
      await readPublicEvidence({ repository: runtime.repository, slug }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleReadSettlement(
  request: Request,
  runtime: ProductRuntime,
  slug: string,
): Promise<Response> {
  const limited = applyRateLimit(runtime, request, "PUBLIC_READ", slug);
  if (limited !== undefined) return limited;
  try {
    return json(
      await readPublicSettlement({ repository: runtime.repository, slug }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePrepareWalletAction(
  request: Request,
  runtime: ProductRuntime,
  slug: string,
  action: string,
): Promise<Response> {
  try {
    requireOrigin(request, runtime.config);
    const session = requireSession(request, runtime.config);
    const limited = applyRateLimit(
      runtime,
      request,
      "WALLET_ACTION",
      `${session.walletAddress}:${slug}:${action}:prepare`,
    );
    if (limited !== undefined) return limited;
    await parseStrictJson(request, []);
    const walletRuntime = requireWalletRuntime(runtime);
    const result = await prepareWalletAction({
      runtime: {
        repository: runtime.repository,
        github: runtime.github,
        chain: walletRuntime.chain,
        registrar: walletRuntime.registrar,
        ...(runtime.automation === undefined
          ? {}
          : { automation: runtime.automation }),
      },
      slug,
      actionPath: action,
      sessionWallet: session.walletAddress,
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    return json(result, result.result === "PREPARED" ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleConfirmWalletAction(
  request: Request,
  runtime: ProductRuntime,
  slug: string,
  action: string,
): Promise<Response> {
  try {
    requireOrigin(request, runtime.config);
    const session = requireSession(request, runtime.config);
    const limited = applyRateLimit(
      runtime,
      request,
      "WALLET_ACTION",
      `${session.walletAddress}:${slug}:${action}:confirm`,
    );
    if (limited !== undefined) return limited;
    const body = await parseStrictJson(request, ["transactionHash"]);
    if (typeof body.transactionHash !== "string")
      throw new Error("INVALID_REQUEST");
    const walletRuntime = requireWalletRuntime(runtime);
    return json(
      await confirmWalletAction({
        runtime: {
          repository: runtime.repository,
          github: runtime.github,
          chain: walletRuntime.chain,
          registrar: walletRuntime.registrar,
          ...(runtime.automation === undefined
            ? {}
            : { automation: runtime.automation }),
        },
        slug,
        actionPath: action,
        sessionWallet: session.walletAddress,
        transactionHash: body.transactionHash,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleRetryPact(
  request: Request,
  runtime: ProductRuntime,
  slug: string,
): Promise<Response> {
  try {
    requireOrigin(request, runtime.config);
    const session = requireSession(request, runtime.config);
    const limited = applyRateLimit(
      runtime,
      request,
      "MANUAL_RETRY",
      `${session.walletAddress}:${slug}`,
    );
    if (limited !== undefined) return limited;
    await parseStrictJson(request, []);
    const idempotencyKey = validateIdempotencyKey(
      request.headers.get("idempotency-key"),
    );
    const draft = await runtime.repository.getDraftBySlug(slug);
    if (draft === undefined) throw new ProductError("PACT_NOT_FOUND", 404);
    if (
      session.walletAddress !== draft.creatingWallet &&
      session.walletAddress !== draft.providerAddress
    ) {
      throw new ProductError("RETRY_NOT_AUTHORIZED", 403);
    }
    if (draft.linkedPactRecordId === null)
      throw new ProductError("CANONICAL_JOB_NOT_LINKED", 409);
    if (runtime.automation === undefined)
      throw new Error("AUTOMATION_RUNTIME_UNAVAILABLE");
    const result = await runtime.automation.wake(
      draft.id,
      draft.linkedPactRecordId,
      idempotencyKey,
    );
    return json({ status: "QUEUED", replayed: result.replayed }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
