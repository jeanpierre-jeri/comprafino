import { desc, asc, eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  discoveryDailyLimit,
  discoveryQueryForSearch,
  parseDiscoveryOptions,
} from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { discoveryQueries } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>;
export { discoveryQueryForSearch, parseDiscoveryOptions } from "@comprafino/core";
export const discoveryOutcomeSchema = z.object({
  status: z.enum(["completed", "no_results", "partial", "failed"]),
  resultCount: z.number().int().min(0).max(30),
  error: z.enum(["Retailer discovery failed.", "Catalog derivation failed."]).nullable(),
});
export type DiscoveryOutcome = z.infer<typeof discoveryOutcomeSchema>;
const claimSchema = z.object({
  id: z.uuid(),
  query: z.string().min(3).max(80),
  attemptedAt: z.coerce.date(),
});
export type DiscoveryClaim = z.infer<typeof claimSchema>;

/** Only call after a successful local public search; failures are never zero results. */
export async function recordDiscoveryForSearch(db: Database, query: string, resultCount: number) {
  const normalizedQuery = discoveryQueryForSearch(query, resultCount);
  if (!normalizedQuery) return false;
  await db
    .insert(discoveryQueries)
    .values({
      normalizedQuery,
      originalQuery: query.trim().replace(/\s+/gu, " "),
    })
    .onConflictDoUpdate({
      target: discoveryQueries.normalizedQuery,
      set: {
        requestCount: sql`least(${discoveryQueries.requestCount}::bigint + 1, 2147483647)::integer`,
        lastRequestedAt: sql`greatest(${discoveryQueries.lastRequestedAt}, clock_timestamp())`,
      },
    });
  return true;
}

const eligible = sql`q.next_eligible_at <= statement_timestamp() and (
  q.last_attempted_at is null or q.last_requested_at >= q.last_attempted_at
  or q.status in ('failed','partial','no_results','processing'))`;
const utcDay = sql`(transaction_timestamp() at time zone 'UTC')::date`;
export function discoveryClaimStatements(limit: number) {
  parseDiscoveryOptions([`--limit=${limit}`]);
  return [
    sql`insert into discovery_daily_budget(day) values (${utcDay}) on conflict (day) do nothing`,
    // Separate statements under READ COMMITTED: concurrent claimers see the
    // updated counter AFTER acquiring this lock, rather than a stale CTE snapshot.
    sql`select day from discovery_daily_budget where day=${utcDay} for update`,
    sql`with candidates as (
      select q.id from discovery_queries q where ${eligible}
      order by q.request_count desc, q.next_eligible_at, q.first_requested_at, q.id
      limit least(${limit}, (select ${discoveryDailyLimit}-processed from discovery_daily_budget where day=${utcDay}))
      for update skip locked
    ), claimed as (
      update discovery_queries q set status='processing', last_attempted_at=date_trunc('milliseconds',statement_timestamp()),
        next_eligible_at=statement_timestamp()+interval '24 hours', error=null
      from candidates c where q.id=c.id
      returning q.id, q.normalized_query as query, q.last_attempted_at as "attemptedAt"
    ), budget as (
      update discovery_daily_budget set processed=processed+(select count(*)::integer from claimed)
      where day=${utcDay} and exists (select 1 from claimed) returning day
    ) select c.* from claimed c cross join budget`,
  ] as const;
}
export async function claimDiscoveryQueries(
  db: Database,
  limit: number,
): Promise<DiscoveryClaim[]> {
  const statements = discoveryClaimStatements(limit);
  const results = await db.batch([
    db.execute(statements[0]),
    db.execute(statements[1]),
    db.execute(statements[2]),
  ]);
  return z.array(claimSchema).parse(results[2].rows);
}
export async function previewDiscoveryQueries(db: Database, limit: number) {
  parseDiscoveryOptions([`--limit=${limit}`]);
  const result = await db.execute(sql`select q.normalized_query as query from discovery_queries q
    where ${eligible} order by q.request_count desc, q.next_eligible_at, q.first_requested_at, q.id
    limit least(${limit}, ${discoveryDailyLimit}-coalesce((select processed from discovery_daily_budget where day=${utcDay}),0))`);
  return z.array(z.object({ query: z.string() })).parse(result.rows);
}
export async function finishDiscoveryQuery(
  db: Database,
  claim: DiscoveryClaim,
  value: DiscoveryOutcome,
) {
  const outcome = discoveryOutcomeSchema.parse(value);
  await db
    .update(discoveryQueries)
    .set({
      status: outcome.status,
      latestResultCount: outcome.resultCount,
      lastCompletedAt: sql`clock_timestamp()`,
      error: outcome.error,
    })
    .where(
      and(
        eq(discoveryQueries.id, claim.id),
        eq(discoveryQueries.lastAttemptedAt, claim.attemptedAt),
      ),
    );
}
export async function inspectDiscovery(db = createDatabase()) {
  const [queries, stats] = await Promise.all([
    db
      .select()
      .from(discoveryQueries)
      .orderBy(desc(discoveryQueries.requestCount), asc(discoveryQueries.firstRequestedAt))
      .limit(100),
    db.execute(sql`select statement_timestamp() as "inspectedAt", count(*)::integer as total,
      count(*) filter (where next_eligible_at>statement_timestamp())::integer as cooldown,
      coalesce((select processed from discovery_daily_budget where day=${utcDay}),0) as "processedToday"
      from discovery_queries`),
  ]);
  return {
    queries,
    stats: z
      .object({
        inspectedAt: z.coerce.date(),
        total: z.number(),
        cooldown: z.number(),
        processedToday: z.number(),
      })
      .parse(stats.rows[0]),
  };
}
