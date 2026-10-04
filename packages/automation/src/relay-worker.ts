import type { RelayProcessResult } from "@pact/orchestrator";
import type { WorkerLogger } from "./types.js";

interface CertifiedRelayAdapter {
  process(): Promise<RelayProcessResult>;
  reconcile(limit?: number): Promise<readonly RelayProcessResult[]>;
}

export function createRelayWorker(input: {
  readonly relay: CertifiedRelayAdapter;
  readonly logger?: WorkerLogger;
}) {
  const logger = input.logger ?? (() => undefined);
  function emit(result: RelayProcessResult, latencyMs: number): void {
    logger({
      role: "relay",
      event: "relay_processed",
      ...(result.intentId === undefined
        ? {}
        : { relayIntentId: result.intentId }),
      ...(result.expectedTxHash === undefined
        ? {}
        : { expectedTxHash: result.expectedTxHash }),
      ...(result.code === undefined ? {} : { reason: result.code }),
      terminalResult: result.state,
      latencyMs,
    });
  }
  return Object.freeze({
    async runOnce(): Promise<{
      readonly reconciled: readonly RelayProcessResult[];
      readonly processed: RelayProcessResult;
    }> {
      const started = Date.now();
      const reconciled = await input.relay.reconcile(10);
      for (const result of reconciled) emit(result, Date.now() - started);
      const processed = await input.relay.process();
      emit(processed, Date.now() - started);
      return { reconciled, processed };
    },
  });
}
