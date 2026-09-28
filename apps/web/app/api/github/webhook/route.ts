import {
  WebhookRequestError,
  parseAuthenticatedGitHubWebhook,
  readBoundedRequestBody,
} from "@pact/orchestrator";
import { json } from "../../../../server/http";
import { getPhase4ARuntime } from "../../../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const service = getPhase4ARuntime();
    const rawBody = await readBoundedRequestBody(request);
    const delivery = parseAuthenticatedGitHubWebhook({
      rawBody,
      headers: request.headers,
      secret: service.config.webhookSecret,
    });
    const result = await service.repository.ingestGitHubDelivery({
      ...delivery,
      receivedAt: new Date(),
    });
    return json(
      {
        accepted: true,
        duplicate: result.duplicate,
        matchedPacts: result.matchedPacts,
        queuedOperations: result.operationIds.length,
      },
      result.duplicate ? 200 : 202,
    );
  } catch (error) {
    if (error instanceof WebhookRequestError) {
      return json({ error: error.code }, error.status);
    }
    return json({ error: "WEBHOOK_INGESTION_FAILED" }, 503);
  }
}
