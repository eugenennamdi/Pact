import {
  json,
  requireEmptyJsonBody,
  requireInternalAuthorization,
} from "../../../../server/http";
import { getPhase4BRuntime } from "../../../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const service = getPhase4BRuntime();
    const unauthorized = requireInternalAuthorization(
      request,
      service.config,
      false,
    );
    if (unauthorized !== undefined) return unauthorized;
    await requireEmptyJsonBody(request);
    const results = await service.relay.reconcile(10);
    return json({ reconciled: results.length, results });
  } catch {
    return json({ error: "RELAY_RECONCILIATION_FAILED" }, 503);
  }
}
