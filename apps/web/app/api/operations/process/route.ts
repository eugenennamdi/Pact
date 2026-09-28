import {
  json,
  requireEmptyJsonBody,
  requireInternalAuthorization,
} from "../../../../server/http";
import { getPhase4ARuntime } from "../../../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const service = getPhase4ARuntime();
    const unauthorized = requireInternalAuthorization(
      request,
      service.config,
      false,
    );
    if (unauthorized !== undefined) return unauthorized;
    await requireEmptyJsonBody(request);
    const ids = await service.repository.listPendingOperationIds(10);
    const results = [];
    for (const id of ids)
      results.push(await service.orchestrator.processOperation(id));
    return json({ processed: results.length, results });
  } catch {
    return json({ error: "PROCESSING_FAILED" }, 503);
  }
}
