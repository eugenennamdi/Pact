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
    const staleBefore = new Date(Date.now() - 5 * 60 * 1_000);
    const recovered =
      await service.repository.recoverTransitionalOperations(staleBefore);
    return json({ recovered });
  } catch {
    return json({ error: "RECOVERY_FAILED" }, 503);
  }
}
