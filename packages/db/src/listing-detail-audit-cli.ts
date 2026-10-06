import { catalogPolicy } from "@comprafino/core";
import { getScopedPriceHistory } from "./price-history.ts";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client.ts";
import { eligibleProducts } from "./public-products.ts";
import {
  getPublicRetailerListingDetail,
  publicListingDetailRows,
  publicRetailerListing,
} from "./listing-detail.ts";

const db = createDatabase();

const now = new Date();

const started = performance.now();

const [rows, depths] = await db.batch([
  db.execute(
    sql`${eligibleProducts} ${publicListingDetailRows(sql`true`, now)} limit ${catalogPolicy.overflowSentinel}`,
  ),
  db.execute(sql`select listing_id as id,count(*)::int as states,
    count(distinct current_price_cents)::int as prices from price_history
    where currency='PEN' and price_unit in ('UN','KG') group by listing_id`),
]);

if (rows.rows.length > catalogPolicy.retainedListingCap) {
  throw new Error("Audit catalog bound exceeded");
}

const listings = rows.rows.map((r) => publicRetailerListing(r, now)).filter((r) => r !== null);

const depth = z
  .array(z.object({ id: z.uuid(), states: z.number(), prices: z.number() }))
  .parse(depths.rows);

const queryMs = performance.now() - started;

const selected = new Set(listings.filter((l) => l.canonicalId).slice(0, 4));

for (const retailer of ["tottus", "plaza-vea", "metro"]) {
  for (const l of listings
    .filter((candidate) => candidate.retailerId === retailer && !candidate.canonicalId)
    .slice(0, 3)) {
    selected.add(l);
  }
}

const transition = listings.find((l) => depth.some((d) => d.id === l.id && d.prices > 1));

const cmr = listings.find((l) => l.conditionalOffers.length);

if (transition) {
  selected.add(transition);
}

if (cmr) {
  selected.add(cmr);
}

const samples = [];

for (const listing of selected) {
  const start = performance.now();
  const detail = await getPublicRetailerListingDetail(db, listing.id, { now });
  samples.push({
    id: listing.id,
    title: listing.title,
    retailer: listing.retailerId,
    canonicalId: listing.canonicalId,
    current: listing.current,
    freshness: listing.freshness,
    ordinary: listing.currentPriceCents,
    cmr: listing.conditionalOffers.map((o) => o.priceCents),
    unit: listing.unitPrice?.displayUnit ?? null,
    depth: depth.find((d) => d.id === listing.id),
    historyStatus: detail?.history?.retailers[0]?.summary.status,
    changes: detail?.history?.retailers[0]?.summary.changeCount,
    queryMs: Math.round(performance.now() - start),
  });
}

const statuses: Record<
  string,
  { sparse: number; empty: number; events: number; verified: number }
> = {};

for (const range of ["7d", "30d", "90d"] as const) {
  const history = await getScopedPriceHistory(
    db,
    sql`with scoped as (
    select l.id,l.title as "displayName",l.id as listing_id,r.id as retailer_id,r.name as retailer_name,
    l.last_seen_at,l.available,l.price_unit from retailer_listings l join retailers r on r.id=l.retailer_id
    where l.id in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(listings.map((l) => l.id))}::jsonb)))`,
    { range, now },
  );
  const summaries = history?.retailers.map((r) => r.summary) ?? [];
  statuses[range] = {
    sparse: summaries.filter((s) => s.status === "insufficient").length,
    empty: summaries.filter((s) => s.status === "empty").length,
    events: summaries.filter((s) => s.status === "events").length,
    verified: summaries.filter((s) => s.segments.length > 0).length,
  };
}

console.log(
  JSON.stringify(
    {
      auditedAt: now,
      publicListings: listings.length,
      currentListings: listings.filter((l) => l.current).length,
      canonicalAssociated: listings.filter((l) => l.canonicalId).length,
      singleState: listings.filter((l) => depth.find((d) => d.id === l.id)?.states === 1).length,
      ordinaryTransitions: listings.filter(
        (l) => (depth.find((d) => d.id === l.id)?.prices ?? 0) > 1,
      ).length,
      catalogQueryMs: Math.round(queryMs),
      historyRanges: statuses,
      samples,
    },
    null,
    2,
  ),
);
