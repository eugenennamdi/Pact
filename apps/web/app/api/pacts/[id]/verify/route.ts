import {
  json,
  requireEmptyJsonBody,
  requireInternalAuthorization,
} from "../../../../../server/http";
import { getPhase4ARuntime } from "../../../../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const service = getPhase4ARuntime();
    const unauthorized = requireInternalAuthorization(
      request,
      service.config,
      true,
    );
    if (unauthorized !== undefined) return unauthorized;
    await requireEmptyJsonBody(request);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey === null || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
      return json({ error: "INVALID_IDEMPOTENCY_KEY" }, 400);
    }
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) return json({ error: "INVALID_PACT_ID" }, 400);
    const pact = await service.repository.getPact(id);
    if (pact === undefined) return json({ error: "PACT_NOT_FOUND" }, 404);
    const operation = await service.repository.enqueueManualOperation(
      id,
      idempotencyKey,
    );
    return json({ operationId: operation.id, state: operation.state }, 202);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_REQUEST";
    if (
      [
        "BODY_TOO_LARGE",
        "UNSUPPORTED_CONTENT_TYPE",
        "MALFORMED_JSON",
        "BODY_MUST_BE_EMPTY_OBJECT",
      ].includes(code)
    ) {
      return json({ error: code }, code === "BODY_TOO_LARGE" ? 413 : 400);
    }
    return json({ error: "MANUAL_TRIGGER_FAILED" }, 503);
  }
}
