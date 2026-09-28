import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export interface PactDatabase {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly sql: Sql;
  close(): Promise<void>;
}
export function validateDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  return value;
}
export function createPactDatabase(databaseUrl: string): PactDatabase {
  const sqlClient = postgres(validateDatabaseUrl(databaseUrl), {
    max: 5,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 1800,
    prepare: false,
  });
  return Object.freeze({
    db: drizzle(sqlClient, { schema }),
    sql: sqlClient,
    close: async () => sqlClient.end({ timeout: 5 }),
  });
}
export function createPactDatabaseFromEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PactDatabase {
  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0)
    throw new Error("DATABASE_URL is required");
  return createPactDatabase(databaseUrl);
}
