import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../schema.ts";
import { requireDatabaseUrl } from "../env.ts";
import { createTestQueryClient } from "./test-query-client.ts";
import { testSchemaClient } from "./test-schema-client.ts";

/** Attach only to the schema owned by the parent harness; never creates/drops it
 * or reads application DATABASE_URL. Used by browser-test fixture mutations.
 */
export function fixtureDatabase(env: Record<string, string | undefined> = process.env) {
  const url = requireDatabaseUrl({ DATABASE_URL: env.TEST_DATABASE_URL });
  const client = createTestQueryClient(url, env.COMPRAFINO_TEST_DATABASE_MODE);
  const scoped = testSchemaClient(client, env.COMPRAFINO_E2E_SCHEMA ?? "");

  return drizzle(scoped, { schema });
}
