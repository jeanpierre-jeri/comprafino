import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateCandidates, selectListingRefresh, offerFreshness } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { readMatchingSample } from "./matching.ts";
import { knownListings } from "./listing-refresh.ts";

const countRow = z.object({ rows: z.number().int().nonnegative() });
const tables = [
  "retailer_listings",
  "listing_normalizations",
  "canonical_products",
  "canonical_product_listings",
  "price_history",
  "ingestion_runs",
  "listing_observation_days",
  "retailer_listing_offers",
  "discovery_queries",
  "discovery_daily_budget",
] as const;
/** Internal metadata only; never expose SQL text, connection identities or credentials. */
export async function catalogBudget(db = createDatabase(), now = new Date()) {
  const counts = await Promise.all(
    tables.map(async (table) => {
      const result = await db.execute(
        sql`select count(*)::integer as rows from ${sql.identifier(table)}`,
      );
      return [table, countRow.parse(result.rows[0]).rows] as const;
    }),
  );
  const rowCounts = Object.fromEntries(counts);
  const [coverage, matching, sizes, history, runs, demand, connections] = await Promise.all([
    knownListings(db),
    readMatchingSample(db, catalogPolicy.retainedListingCap),
    db.execute(
      sql`select c.relname as name,pg_total_relation_size(c.oid)::float8 as "totalBytes",pg_relation_size(c.oid)::float8 as "tableBytes",pg_indexes_size(c.oid)::float8 as "indexBytes" from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=current_schema() and c.relkind='r' order by pg_total_relation_size(c.oid) desc limit 15`,
    ),
    db.execute(
      sql`select count(*)::integer as states,count(*) filter(where valid_until is null)::integer as open,md5(string_agg(row(id,listing_id,current_price_cents,regular_price_cents,currency,price_unit,valid_from,valid_until)::text,'' order by id)) as digest,min(valid_from) as "firstState",count(*) filter(where valid_from>=${new Date(now.getTime() - 7 * 86400000).toISOString()}::timestamptz)::integer as "statesLast7Days",count(*) filter(where valid_from>=${new Date(now.getTime() - 7 * 86400000).toISOString()}::timestamptz and exists(select 1 from price_history earlier where earlier.listing_id=price_history.listing_id and earlier.valid_from<price_history.valid_from))::integer as "changesLast7Days" from price_history`,
    ),
    db.execute(
      sql`select retailer_id as retailer,status,started_at as "startedAt",extract(epoch from ended_at-started_at)::float8 as "durationSeconds",listings_fetched as fetched,listings_persisted as persisted,listings_changed as changed from ingestion_runs order by started_at desc limit 15`,
    ),
    db.execute(
      sql`select count(*)::integer as queries,coalesce(sum(request_count),0)::integer as "lifetimeSearchRequests",count(*) filter(where status='pending')::integer as pending,count(*) filter(where status='processing')::integer as processing,min(first_requested_at) as "firstDemand",(select coalesce(sum(processed),0)::integer from discovery_daily_budget) as "reservedQueryAttempts",(select coalesce(sum(processed),0)::integer from discovery_daily_budget where day=(${now.toISOString()}::timestamptz at time zone 'UTC')::date) as "reservedAttemptsTodayUTC" from discovery_queries`,
    ),
    db.execute(
      sql`select pg_database_size(current_database())::float8 as "databaseBytes",(select count(*)::integer from pg_stat_activity where datname=current_database()) as "visibleConnections"`,
    ),
  ]);
  if ((rowCounts.retailer_listings ?? 0) > catalogPolicy.retainedListingCap)
    throw new Error("Catalog bound exceeded; review capacity before derivation");
  return {
    observedAt: now.toISOString(),
    rowCounts,
    coverage: {
      knownListings: coverage.length,
      publicOffers: coverage.filter((r) => r.public).length,
      stalePublic: coverage.filter((r) => r.public && offerFreshness(r.observedAt, now) !== "fresh")
        .length,
      selectedTargeted: selectListingRefresh(coverage, now, 100).length,
    },
    matching: {
      processed: matching.length,
      candidates: generateCandidates(matching).length,
      persistedWrites: null,
      note: "Read-only candidate generation; last matching writes are not stored.",
    },
    database: z
      .object({
        databaseBytes: z.number().nonnegative(),
        visibleConnections: z.number().int().nonnegative(),
      })
      .parse(connections.rows[0]),
    largestRelations: z
      .array(
        z.object({
          name: z.string(),
          totalBytes: z.number().nonnegative(),
          tableBytes: z.number().nonnegative(),
          indexBytes: z.number().nonnegative(),
        }),
      )
      .parse(sizes.rows),
    history: z
      .object({
        states: z.number().int(),
        open: z.number().int(),
        digest: z.string().nullable(),
        firstState: z.coerce.date().nullable(),
        statesLast7Days: z.number().int(),
        changesLast7Days: z.number().int(),
      })
      .parse(history.rows[0]),
    recentIngestion: z
      .array(
        z.object({
          retailer: z.string(),
          status: z.string(),
          startedAt: z.coerce.date(),
          durationSeconds: z.number().nullable(),
          fetched: z.number().int(),
          persisted: z.number().int(),
          changed: z.number().int(),
        }),
      )
      .parse(runs.rows),
    demand: z
      .object({
        queries: z.number().int(),
        lifetimeSearchRequests: z.number().int(),
        pending: z.number().int(),
        processing: z.number().int(),
        firstDemand: z.coerce.date().nullable(),
        reservedQueryAttempts: z.number().int().nonnegative(),
        reservedAttemptsTodayUTC: z.number().int().nonnegative(),
      })
      .parse(demand.rows[0]),
  };
}
