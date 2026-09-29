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
    return json(await service.relay.process());
  } catch {
    return json({ error: "RELAY_PROCESSING_FAILED" }, 503);
  }
}
