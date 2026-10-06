import {
  checkWebReadiness,
  type WebReadinessResult,
} from "../../../server/deployment-health";

export const dynamic = "force-dynamic";

export function webHealthResponse(readiness: WebReadinessResult): Response {
  if (!readiness.ready) {
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        role: "web",
        event: "readiness_failed",
        reason: readiness.reason,
      }),
    );
  }
  return Response.json(
    { status: readiness.ready ? "ready" : "not_ready" },
    {
      status: readiness.ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function GET(): Promise<Response> {
  return webHealthResponse(
    await checkWebReadiness({ environment: process.env }),
  );
}
