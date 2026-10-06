import { createServer, type Server } from "node:http";
import type { Address } from "viem";
import type { WorkerHealthSnapshot } from "./types.js";

type DependencyState = "UNKNOWN" | "READY" | "FAILED";

export function safeWorkerReason(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_:-]{0,95}$/.test(error.message)
  ) {
    return error.message;
  }
  return "WORKER_FAILURE";
}

export interface WorkerHealth {
  read(): WorkerHealthSnapshot;
  response(): Readonly<{
    status: "ready" | "not_ready";
    role: "verifier" | "relay";
  }>;
  database(ready: boolean): void;
  arcRpc(ready: boolean): void;
  github(ready: boolean): void;
  relayBalance(input: {
    readonly balance: bigint;
    readonly required: bigint;
    readonly unresolvedBroadcastUnknown: number;
  }): void;
  loopSucceeded(result: string): void;
  loopFailed(reason: string): void;
}

export function loadWorkerHealthPort(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment.PORT ?? "8080";
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT is invalid");
  return port;
}

export function createWorkerHealth(input: {
  readonly role: "verifier" | "relay";
  readonly signerAddress: Address;
  readonly expectedSignerAddress: Address;
  readonly includesGithub: boolean;
  readonly staleAfterMs: number;
  readonly now?: () => Date;
}): WorkerHealth {
  const now = input.now ?? (() => new Date());
  let database: DependencyState = "UNKNOWN";
  let arcRpc: DependencyState = "UNKNOWN";
  let github: DependencyState = "UNKNOWN";
  let balance: DependencyState = "UNKNOWN";
  let balanceWei: bigint | undefined;
  let requiredWei: bigint | undefined;
  let unresolvedBroadcastUnknown: number | undefined;
  let lastSuccessfulLoop: Date | undefined;
  let lastLoopResult: string | null = null;
  let lastFailure: string | null = null;
  const signerIdentity =
    input.signerAddress.toLowerCase() ===
    input.expectedSignerAddress.toLowerCase()
      ? "READY"
      : "FAILED";

  function read(): WorkerHealthSnapshot {
    const stale =
      lastSuccessfulLoop === undefined ||
      now().getTime() - lastSuccessfulLoop.getTime() > input.staleAfterMs;
    const ready =
      signerIdentity === "READY" &&
      database === "READY" &&
      arcRpc === "READY" &&
      (!input.includesGithub || github === "READY") &&
      (input.role !== "relay" || balance === "READY") &&
      !stale &&
      lastFailure === null;
    return Object.freeze({
      role: input.role,
      ready,
      configuration: "READY" as const,
      database,
      arcRpc,
      ...(input.includesGithub ? { github } : {}),
      signerIdentity,
      ...(input.role === "relay"
        ? {
            relayBalance: balance,
            ...(balanceWei === undefined
              ? {}
              : { relayBalanceWei: balanceWei }),
            ...(requiredWei === undefined
              ? {}
              : { relayRequiredWei: requiredWei }),
            ...(unresolvedBroadcastUnknown === undefined
              ? {}
              : { unresolvedBroadcastUnknown }),
          }
        : {}),
      lastSuccessfulLoop: lastSuccessfulLoop?.toISOString() ?? null,
      lastLoopResult,
      stale,
      lastFailure,
    });
  }

  return Object.freeze({
    read,
    response: () =>
      Object.freeze({
        status: read().ready ? ("ready" as const) : ("not_ready" as const),
        role: input.role,
      }),
    database(ready: boolean): void {
      database = ready ? "READY" : "FAILED";
    },
    arcRpc(ready: boolean): void {
      arcRpc = ready ? "READY" : "FAILED";
    },
    github(ready: boolean): void {
      if (input.includesGithub) github = ready ? "READY" : "FAILED";
    },
    relayBalance(result: {
      readonly balance: bigint;
      readonly required: bigint;
      readonly unresolvedBroadcastUnknown: number;
    }): void {
      if (input.role !== "relay") return;
      balanceWei = result.balance;
      requiredWei = result.required;
      unresolvedBroadcastUnknown = result.unresolvedBroadcastUnknown;
      balance = result.balance >= result.required ? "READY" : "FAILED";
    },
    loopSucceeded(result: string): void {
      lastSuccessfulLoop = now();
      lastLoopResult = result;
      lastFailure = null;
    },
    loopFailed(reason: string): void {
      lastLoopResult = "FAILED";
      lastFailure = reason;
    },
  });
}

export async function startWorkerHealthServer(
  health: WorkerHealth,
  port: number,
  host = "0.0.0.0",
): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.method !== "GET" || request.url !== "/health") {
      response.statusCode = 404;
      response.end('{"status":"not_found"}');
      return;
    }
    const body = health.response();
    response.statusCode = body.status === "ready" ? 200 : 503;
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
