import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  knownListingSchema,
  matchingVersion,
  selectListingRefresh,
  parseListingRefreshOptions,
} from "@comprafino/core";
import type { KnownListing } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
type Database = ReturnType<typeof createDatabase>;
export async function knownListings(db: Database) {
  const result =
    await db.execute(sql`select l.id,l.retailer_id as retailer,l.external_id as "externalId",
    l.product_id as "productId",l.url,l.last_seen_at as "observedAt",l.first_seen_via as "firstSeenVia",
    l.last_category_observed_at as "lastCategoryObservedAt",l.last_targeted_attempt_at as "lastTargetedAttemptAt",
    exists (select 1 from canonical_product_listings a where a.listing_id=l.id
      and a.method='automatic' and a.matching_version=${matchingVersion} and a.confidence>=0.90
      and not exists (select 1 from canonical_product_listings bad where bad.canonical_product_id=a.canonical_product_id
        and (bad.method<>'automatic' or bad.matching_version<>${matchingVersion} or bad.confidence<0.90))
      and (select count(*) from canonical_product_listings peer where peer.canonical_product_id=a.canonical_product_id)>=2) as public
    from retailer_listings l order by l.id limit 1001`);
  const rows = z.array(knownListingSchema).parse(result.rows);
  if (rows.length > 1000) throw new Error("Known listing refresh exceeds complete catalog bound");
  return rows;
}
export async function previewListingRefresh(
  db: Database,
  options: ReturnType<typeof parseListingRefreshOptions>,
  now = new Date(),
) {
  const rows = (await knownListings(db)).filter(
    (row) =>
      (!options.retailer || row.retailer === options.retailer) &&
      (!options.externalId || row.externalId === options.externalId),
  );
  // Explicit one-SKU inspection permits live repeat validation without changing scheduler policy.
  return options.externalId ? rows.slice(0, 1) : selectListingRefresh(rows, now, options.limit);
}
export async function claimListingRefresh(db: Database, row: KnownListing, at: Date) {
  const results = await db.batch([
    db.execute(sql`select id from retailers where id=${row.retailer} for update`),
    db.execute(sql`update retailer_listings set last_targeted_attempt_at=${at.toISOString()}::timestamptz,targeted_status='failed'
      where id=${row.id}::uuid and last_seen_at=${row.observedAt.toISOString()}::timestamptz
      and last_targeted_attempt_at is not distinct from ${row.lastTargetedAttemptAt?.toISOString() ?? null}::timestamptz returning id`),
  ]);
  return results[1].rows.length === 1;
}
export async function finishListingRefresh(
  db: Database,
  row: KnownListing,
  at: Date,
  status: "observed" | "unavailable" | "not-found" | "failed",
) {
  await db.batch([
    db.execute(sql`select id from retailers where id=${row.retailer} for update`),
    db.execute(sql`update retailer_listings set targeted_status=${status},
      available=case when ${status}='unavailable' and last_seen_at<=${at.toISOString()}::timestamptz then false else available end
      where id=${row.id}::uuid and last_targeted_attempt_at=${at.toISOString()}::timestamptz`),
  ]);
}
