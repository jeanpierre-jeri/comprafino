import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "./env.ts";
import * as schema from "./schema.ts";

/** Call only from server code or ingestion scripts; importing this module opens no connection. */
export function createDatabase(env: Record<string, string | undefined> = process.env) {
  return drizzle(neon(requireDatabaseUrl(env)), { schema });
}
