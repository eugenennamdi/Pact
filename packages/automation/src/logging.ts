import type { WorkerLogEvent, WorkerLogger } from "./types.js";

export const jsonWorkerLogger: WorkerLogger = (event: WorkerLogEvent): void => {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
  );
};
