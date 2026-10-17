import { drizzle } from "drizzle-orm/neon-http";
import { z } from "zod";
import * as tables from "../../schema.ts";
import { ownedTestDatabase } from "../database.ts";
import { seedCatalogBenchmark, growCatalogBenchmark } from "../catalog-benchmark-fixtures.ts";
import { createTestQueryClient } from "../test-query-client.ts";
import { testSchemaClient } from "../test-schema-client.ts";
import { hostingDatabaseTarget, requireOwnedState, type HostingState } from "./config.ts";

export async function createHostingFixtures(
  commit: string,
  env: Record<string, string | undefined> = process.env,
  onOwned?: (state: HostingState) => void,
) {
  z.string()
    .regex(/^[0-9a-f]{40}$/u)
    .parse(commit);
  const target = hostingDatabaseTarget(env);
  const harness = ownedTestDatabase(env);
  const asOf = new Date();
  await harness.setup();
  try {
    await harness.scoped.query(
      "create table hosting_test_owner (run_id text primary key, source_commit text not null)",
    );
    await harness.scoped.query("insert into hosting_test_owner values ($1, $2)", [
      target.runId,
      commit,
    ]);
    const state: HostingState = {
      version: 1,
      runId: target.runId,
      commit,
      schema: harness.schema,
      targetHash: target.targetHash,
      asOf: asOf.toISOString(),
      size: 80,
      exactIds: [],
    };
    onOwned?.(state);
    await seedCatalogBenchmark(harness, asOf);
    return state;
  } catch (error) {
    await harness.dispose();
    throw error;
  }
}

export async function openHostingFixtures(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const { state, target } = requireOwnedState(value, env);
  const client = createTestQueryClient(target.url, env.COMPRAFINO_TEST_DATABASE_MODE);
  const scoped = testSchemaClient(client, state.schema);
  const owners = z
    .array(z.object({ run_id: z.string(), source_commit: z.string() }))
    .parse(await scoped.query("select run_id, source_commit from hosting_test_owner"));
  if (
    owners.length !== 1 ||
    owners[0]?.run_id !== state.runId ||
    owners[0]?.source_commit !== state.commit
  ) {
    throw new Error("Schema ownership marker does not match the manifest");
  }
  return { state, client, scoped, db: drizzle(scoped, { schema: tables }) };
}

export async function scaleHostingFixtures(
  value: unknown,
  size: number,
  env: Record<string, string | undefined> = process.env,
) {
  const harness = await openHostingFixtures(value, env);
  if ((size !== 2000 && size !== 10000 && size !== 50000) || size <= harness.state.size) {
    throw new Error("Expected an increasing fixture size: 2000, 10000 or 50000");
  }
  const counts = z
    .array(z.object({ count: z.number() }))
    .parse(await harness.scoped.query("select count(*)::int as count from retailer_listings"));
  if (counts[0]?.count !== harness.state.size) {
    throw new Error("Fixture size differs from the manifest; clean the interrupted run first");
  }
  const result = await growCatalogBenchmark(harness, harness.state.size, size);
  const state: HostingState = { ...harness.state, size, exactIds: result.exactIds };
  return {
    state,
    counts: result.counts,
    storage: await hostingFixtureStorage(harness),
  };
}

export async function hostingFixtureStorage(
  harness: Awaited<ReturnType<typeof openHostingFixtures>>,
) {
  return z
    .array(z.object({ bytes: z.string() }))
    .parse(
      await harness.client.query(
        "select coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint::text as bytes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind in ('r','m')",
        [harness.state.schema],
      ),
    )[0]?.bytes;
}

/** Cleanup needs both a matching marker and an explicit acknowledgement that the
 * runner/deployment has stopped. No database, project or public table is dropped. */
export async function removeHostingFixtures(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const harness = await openHostingFixtures(value, env);
  if (env.HOSTING_TEST_STOPPED !== harness.state.runId) {
    throw new Error("Stop the test deployment and runner before fixture cleanup");
  }
  await harness.client.query(`drop schema "${harness.state.schema}" cascade`);
}
