import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/neon-http";
import { z } from "zod";
import * as tables from "../schema.ts";
import { requireDatabaseUrl } from "../env.ts";
import { createTestQueryClient } from "./test-query-client.ts";
import { testSchemaClient } from "./test-schema-client.ts";

/** One owner, one random schema, checked-in migrations; never reads DATABASE_URL. */
export function ownedTestDatabase(env: Record<string, string | undefined> = process.env) {
  const url = requireDatabaseUrl({ DATABASE_URL: env.TEST_DATABASE_URL });
  const client = createTestQueryClient(url, env.COMPRAFINO_TEST_DATABASE_MODE);
  const schema = `comprafino_e2e_${randomUUID().replaceAll("-", "")}`;
  const quoted = `"${schema}"`;
  const scoped = testSchemaClient(client, schema);
  const db = drizzle(scoped, { schema: tables });
  let created = false;

  async function dispose() {
    if (created) {
      await client.query(`drop schema ${quoted} cascade`);
      created = false;
    }
  }

  async function setup() {
    const journal = z
      .object({ entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z_]+$/u) })) })
      .parse(
        JSON.parse(
          readFileSync(new URL("../../migrations/meta/_journal.json", import.meta.url), "utf8"),
        ) as unknown,
      );

    try {
      await client.query(`create schema ${quoted}`);
      created = true;
      const path = z
        .array(z.object({ current_schema: z.string() }))
        .parse(await scoped.query("select current_schema()"));

      if (path[0]?.current_schema !== schema) {
        throw new Error("Test schema isolation failed");
      }

      await scoped.transaction(
        journal.entries.flatMap(({ tag }) =>
          readFileSync(new URL(`../../migrations/${tag}.sql`, import.meta.url), "utf8")
            .split("--> statement-breakpoint")
            .filter((s) => s.trim() && !s.trim().startsWith("CREATE EXTENSION"))
            .map((s) => scoped.query(s.replaceAll('"public".', `${quoted}.`))),
        ),
      );
    } catch (error) {
      await dispose();

      throw error;
    }
  }

  /** Reset fixture data together, preserving retailer seeds and FK constraints. */
  async function reset() {
    if (!created) {
      throw new Error("Test schema is not owned");
    }

    await scoped.query(
      "truncate retailer_listings, canonical_products, ingestion_runs, discovery_queries, discovery_daily_budget cascade",
    );
  }

  return { url, schema, client, scoped, db, setup, reset, dispose };
}
