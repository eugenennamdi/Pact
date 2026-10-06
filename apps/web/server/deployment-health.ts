import { createPactDatabase, type PactDatabase } from "@pact/database";
import { loadProductConfig } from "../../../packages/product/src/index";

export type WebReadinessResult = Readonly<
  | { ready: true }
  | { ready: false; reason: "CONFIG_INVALID" | "DATABASE_UNAVAILABLE" }
>;

let database: PactDatabase | undefined;
let databaseUrl: string | undefined;

async function defaultDatabaseProbe(url: string): Promise<void> {
  if (database === undefined || databaseUrl !== url) {
    await database?.close();
    database = createPactDatabase(url);
    databaseUrl = url;
  }
  await database.sql`SELECT 1`;
}

export async function checkWebReadiness(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly databaseProbe?: (databaseUrl: string) => Promise<void>;
}): Promise<WebReadinessResult> {
  let configuredDatabaseUrl: string;
  try {
    configuredDatabaseUrl = loadProductConfig(input.environment).databaseUrl;
  } catch {
    return Object.freeze({ ready: false, reason: "CONFIG_INVALID" });
  }
  try {
    await (input.databaseProbe ?? defaultDatabaseProbe)(configuredDatabaseUrl);
    return Object.freeze({ ready: true });
  } catch {
    return Object.freeze({ ready: false, reason: "DATABASE_UNAVAILABLE" });
  }
}
