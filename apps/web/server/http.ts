import {
  authorizeInternalRequest,
  type Phase4AConfig,
} from "@pact/orchestrator";

export const MANUAL_BODY_LIMIT_BYTES = 1024;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function requireInternalAuthorization(
  request: Request,
  config: Phase4AConfig,
  requireOrigin: boolean,
): Response | undefined {
  return authorizeInternalRequest(request, config, requireOrigin)
    ? undefined
    : json({ error: "UNAUTHORIZED" }, 401);
}

export async function requireEmptyJsonBody(request: Request): Promise<void> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) > MANUAL_BODY_LIMIT_BYTES
  ) {
    throw new Error("BODY_TOO_LARGE");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MANUAL_BODY_LIMIT_BYTES)
    throw new Error("BODY_TOO_LARGE");
  if (bytes.byteLength === 0) return;
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error("MALFORMED_JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw new Error("BODY_MUST_BE_EMPTY_OBJECT");
  }
}
