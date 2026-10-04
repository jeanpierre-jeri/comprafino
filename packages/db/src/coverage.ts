import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  offerFreshness,
  retailerIdSchema,
  selectListingRefresh,
  hasTargetedRefreshPath,
  listingNeedsRefresh,
} from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { knownListings } from "./listing-refresh.ts";
import { inspectDiscovery } from "./discovery.ts";
import { searchCanonicalProducts } from "./public-products.ts";
export async function coverageReport(db = createDatabase(), now = new Date()) {
  const [rows, discovery, states, themesResult] = await Promise.all([
    knownListings(db),
    inspectDiscovery(db),
    db.execute(sql`select id,available,active,targeted_status as status from retailer_listings`),
    db.execute(sql`select coalesce(n.brand_key,'unknown') as brand,coalesce(l.category,'unknown') as category,
      count(*)::integer as listings,count(distinct l.discovery_query_id)::integer as queries
      from retailer_listings l left join listing_normalizations n on n.listing_id=l.id
      where l.last_category_observed_at is null group by n.brand_key,l.category
      order by count(*) desc,brand,category limit 20`),
  ]);
  const stateRows = z
    .array(
      z.object({
        id: z.uuid(),
        available: z.boolean().nullable(),
        active: z.boolean(),
        status: z.enum(["observed", "unavailable", "not-found", "failed"]).nullable(),
      }),
    )
    .parse(states.rows);
  const stateMap = new Map(stateRows.map((row) => [row.id, row]));
  const publicRows = rows.filter((row) => row.public);
  const selected = selectListingRefresh(rows, now, 100);
  const retailers = retailerIdSchema.options.map((retailer) => {
    const known = rows.filter((row) => row.retailer === retailer);
    const linked = known.filter((row) => row.public);
    return {
      retailer,
      known: known.length,
      public: linked.length,
      categoryObservedPublic: linked.filter((row) => row.lastCategoryObservedAt).length,
      categoryObservedWithin24h: linked.filter(
        (row) =>
          row.lastCategoryObservedAt &&
          now.getTime() - row.lastCategoryObservedAt.getTime() <= 24 * 3_600_000,
      ).length,
      outsideObservedCategoryCoverage: linked.filter((row) => !row.lastCategoryObservedAt).length,
      eligible: known.filter((row) => listingNeedsRefresh(row, now)).length,
      fresh: linked.filter((row) => offerFreshness(row.observedAt, now) === "fresh").length,
      stale: linked.filter((row) => offerFreshness(row.observedAt, now) === "stale").length,
      tooStale: linked.filter((row) => offerFreshness(row.observedAt, now) === "too-stale").length,
      unavailable: linked.filter((row) => stateMap.get(row.id)?.available === false).length,
      lastTargetedAttempt: known.reduce<Date | null>(
        (latest, row) =>
          row.lastTargetedAttemptAt && (!latest || row.lastTargetedAttemptAt > latest)
            ? row.lastTargetedAttemptAt
            : latest,
        null,
      ),
      targetedLatestOutcomes: Object.fromEntries(
        ["observed", "unavailable", "not-found", "failed"].map((status) => [
          status,
          known.filter((row) => stateMap.get(row.id)?.status === status).length,
        ]),
      ),
      publicOrigins: Object.fromEntries(
        ["unknown", "category", "discovery"].map((source) => [
          source,
          linked.filter((row) => row.firstSeenVia === source).length,
        ]),
      ),
      origins: Object.fromEntries(
        ["unknown", "category", "discovery"].map((source) => [
          source,
          known.filter((row) => row.firstSeenVia === source).length,
        ]),
      ),
    };
  });
  const demand = [];
  // Small sequential DB report: source requests never occur here.
  for (const query of discovery.queries.slice(0, 20)) {
    const linked =
      await db.execute(sql`select count(distinct a.canonical_product_id)::integer as groups
      from retailer_listings l join canonical_product_listings a on a.listing_id=l.id where l.discovery_query_id=${query.id}::uuid`);
    const attributed = z
      .object({ groups: z.number().int().nonnegative() })
      .parse(linked.rows[0]).groups;
    demand.push({
      query: query.normalizedQuery,
      requests: query.requestCount,
      status: query.status,
      firstAcquisitionGroups: attributed,
      currentlyMatchingPublicGroups: (await searchCanonicalProducts(db, query.normalizedQuery, now))
        .length,
    });
  }
  return {
    inspectedAt: now,
    knownListings: rows.length,
    publicOffers: publicRows.length,
    discoveryAcquiredPublicOffers: publicRows.filter((row) => row.firstSeenVia === "discovery")
      .length,
    fresh: publicRows.filter((row) => offerFreshness(row.observedAt, now) === "fresh").length,
    stale: publicRows.filter((row) => offerFreshness(row.observedAt, now) === "stale").length,
    tooStale: publicRows.filter((row) => offerFreshness(row.observedAt, now) === "too-stale")
      .length,
    publicWithoutCategoryObservation: publicRows.filter((row) => !row.lastCategoryObservedAt)
      .length,
    publicOutsideCategoryCoverage: publicRows
      .filter((row) => !row.lastCategoryObservedAt)
      .map((row) => ({ retailer: row.retailer, externalId: row.externalId })),
    targetRefreshable: rows.filter(hasTargetedRefreshPath).length,
    publicTargetRefreshable: publicRows.filter(hasTargetedRefreshPath).length,
    withoutTargetPath: rows.filter((row) => !hasTargetedRefreshPath(row)).length,
    selected: selected.map((row) => ({ retailer: row.retailer, externalId: row.externalId })),
    retailers,
    demand,
    recurringBrandsAndCategoriesOutsideObservedCoverage: z
      .array(
        z.object({
          brand: z.string(),
          category: z.string(),
          listings: z.number().int(),
          queries: z.number().int(),
        }),
      )
      .parse(themesResult.rows),
    provenanceNote:
      "Historical origin and query attribution are unknown before migration 0004. Current search matches do not prove creation by a query. Missing category observations are unverified coverage until a complete scheduled scope has run.",
  };
}
