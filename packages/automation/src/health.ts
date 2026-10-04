import type { WorkerHealthSnapshot } from "./types.js";

export function createWorkerHealth(input: {
  readonly role: "verifier" | "relay";
  readonly signerAddress: string;
  readonly includesGithub: boolean;
}) {
  let snapshot: WorkerHealthSnapshot = Object.freeze({
    role: input.role,
    ready: false,
    database: "UNKNOWN",
    arcRpc: "UNKNOWN",
    ...(input.includesGithub ? { github: "UNKNOWN" as const } : {}),
    signerAddress: input.signerAddress,
    lastSuccessfulLoop: null,
    lastFailure: null,
  });
  return Object.freeze({
    read: () => snapshot,
    ready(): void {
      snapshot = Object.freeze({
        ...snapshot,
        ready: true,
        database: "READY",
        arcRpc: "READY",
        ...(input.includesGithub ? { github: "READY" as const } : {}),
        lastSuccessfulLoop: new Date().toISOString(),
        lastFailure: null,
      });
    },
    failed(reason: string): void {
      snapshot = Object.freeze({
        ...snapshot,
        ready: false,
        lastFailure: reason,
      });
    },
  });
}
