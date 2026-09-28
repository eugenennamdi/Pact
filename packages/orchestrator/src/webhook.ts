import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeGithubPrMergedCondition } from "@pact/protocol";

export const GITHUB_WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;
export const GITHUB_WEBHOOK_SECRET_MIN_BYTES = 16;
export const GITHUB_WEBHOOK_SECRET_MAX_BYTES = 256;

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;
const DELIVERY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WebhookFailureCode =
  | "BODY_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "MISSING_SIGNATURE"
  | "MALFORMED_SIGNATURE"
  | "INVALID_SIGNATURE"
  | "MISSING_DELIVERY_ID"
  | "MALFORMED_DELIVERY_ID"
  | "MISSING_EVENT"
  | "MALFORMED_JSON"
  | "INVALID_PAYLOAD";

export class WebhookRequestError extends Error {
  readonly code: WebhookFailureCode;
  readonly status: number;
  constructor(code: WebhookFailureCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface ParsedGitHubWebhook {
  readonly deliveryId: string;
  readonly event: string;
  readonly action: string;
  readonly relevant: boolean;
  readonly repository?: string;
  readonly pullRequest?: number;
}

export function validateWebhookSecret(secret: string): string {
  const length = new TextEncoder().encode(secret).byteLength;
  if (
    length < GITHUB_WEBHOOK_SECRET_MIN_BYTES ||
    length > GITHUB_WEBHOOK_SECRET_MAX_BYTES
  ) {
    throw new Error("GITHUB_WEBHOOK_SECRET length is invalid");
  }
  return secret;
}

function header(
  headers: Headers,
  name: string,
  missing: WebhookFailureCode,
): string {
  const value = headers.get(name);
  if (value === null || value.length === 0)
    throw new WebhookRequestError(missing, 400);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAuthenticatedGitHubWebhook(input: {
  readonly rawBody: Uint8Array;
  readonly headers: Headers;
  readonly secret: string;
}): ParsedGitHubWebhook {
  if (input.rawBody.byteLength > GITHUB_WEBHOOK_BODY_LIMIT_BYTES) {
    throw new WebhookRequestError("BODY_TOO_LARGE", 413);
  }
  const signatureValue = input.headers.get("x-hub-signature-256");
  if (signatureValue === null)
    throw new WebhookRequestError("MISSING_SIGNATURE", 401);
  const match = SIGNATURE_PATTERN.exec(signatureValue);
  if (match === null) throw new WebhookRequestError("MALFORMED_SIGNATURE", 401);
  const provided = Buffer.from(match[1] ?? "", "hex");
  const expected = createHmac("sha256", validateWebhookSecret(input.secret))
    .update(input.rawBody)
    .digest();
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new WebhookRequestError("INVALID_SIGNATURE", 401);
  }

  const contentType = input.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new WebhookRequestError("UNSUPPORTED_CONTENT_TYPE", 415);
  }

  const deliveryId = header(
    input.headers,
    "x-github-delivery",
    "MISSING_DELIVERY_ID",
  );
  if (!DELIVERY_PATTERN.test(deliveryId)) {
    throw new WebhookRequestError("MALFORMED_DELIVERY_ID", 400);
  }
  const event = header(input.headers, "x-github-event", "MISSING_EVENT");
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody),
    ) as unknown;
  } catch {
    throw new WebhookRequestError("MALFORMED_JSON", 400);
  }
  if (!isRecord(payload) || typeof payload.action !== "string") {
    throw new WebhookRequestError("INVALID_PAYLOAD", 400);
  }
  const action = payload.action;
  if (event !== "pull_request" || action !== "closed") {
    return Object.freeze({
      deliveryId: deliveryId.toLowerCase(),
      event,
      action,
      relevant: false,
    });
  }
  if (
    typeof payload.number !== "number" ||
    !Number.isSafeInteger(payload.number) ||
    payload.number <= 0 ||
    !isRecord(payload.repository) ||
    typeof payload.repository.full_name !== "string"
  ) {
    throw new WebhookRequestError("INVALID_PAYLOAD", 400);
  }
  let repository: string;
  try {
    repository = normalizeGithubPrMergedCondition({
      provider: "github",
      repository: payload.repository.full_name,
      pullRequest: payload.number,
      baseBranch: "routing-only",
      event: "PR_MERGED",
    }).repository;
  } catch {
    throw new WebhookRequestError("INVALID_PAYLOAD", 400);
  }
  return Object.freeze({
    deliveryId: deliveryId.toLowerCase(),
    event,
    action,
    relevant: true,
    repository,
    pullRequest: payload.number,
  });
}

export async function readBoundedRequestBody(
  request: Request,
  maximumBytes = GITHUB_WEBHOOK_BODY_LIMIT_BYTES,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) > maximumBytes
  ) {
    throw new WebhookRequestError("BODY_TOO_LARGE", 413);
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new WebhookRequestError("BODY_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
