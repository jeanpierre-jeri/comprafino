import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { testSchemaClient } from "./test-schema-client.ts";
import { requireDatabaseUrl } from "./env.ts";
import * as schema from "./schema.ts";

/** Call only from server code or ingestion scripts; importing this module opens no connection. */
export function createDatabase(env: Record<string, string | undefined> = process.env) {
  const client = neon(requireDatabaseUrl(env));
  return drizzle(
    env.COMPRAFINO_E2E_SCHEMA ? testSchemaClient(client, env.COMPRAFINO_E2E_SCHEMA) : client,
    { schema },
  );
}
