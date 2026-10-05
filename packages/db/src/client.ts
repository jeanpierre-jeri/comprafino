import { createTestQueryClient } from "./test-query-client.ts";
import { drizzle } from "drizzle-orm/neon-http";
import { testSchemaClient } from "./test-schema-client.ts";
import { requireDatabaseUrl } from "./env.ts";
import * as schema from "./schema.ts";

/** Call only from server code or ingestion scripts; importing this module opens no connection. */
export function createDatabase(env: Record<string, string | undefined> = process.env) {
  if (env.COMPRAFINO_TEST_DATABASE_MODE && !env.COMPRAFINO_E2E_SCHEMA)
    throw new Error("Local web tests require an isolated COMPRAFINO_E2E_SCHEMA");
  const client = createTestQueryClient(requireDatabaseUrl(env), env.COMPRAFINO_TEST_DATABASE_MODE);
  return drizzle(
    env.COMPRAFINO_E2E_SCHEMA ? testSchemaClient(client, env.COMPRAFINO_E2E_SCHEMA) : client,
    { schema },
  );
}
