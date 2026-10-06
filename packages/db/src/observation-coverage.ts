import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { observationDay, retailerIdSchema } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { eligibleProducts } from "./public-products.ts";

const count = z.number().int().nonnegative();

/** Read-only health snapshot. Public means eligible exact-product offers, including stale ones. */
export async function observationCoverageReport(db = createDatabase(), now = new Date()) {
  const today = observationDay(now);
  const publicScope = sql`${eligibleProducts}, public_listings as (
    select distinct l.id from products p join canonical_product_listings a on a.canonical_product_id=p.id
    join retailer_listings l on l.id=a.listing_id and l.retailer_id=a.retailer_id
    join listing_normalizations n on n.listing_id=l.id
    join price_history h on h.listing_id=l.id and h.valid_until is null
    where l.active and h.currency='PEN' and h.price_unit='UN'
  )`;
  const [totals, retailers, gaps] = await db.batch([
    db.execute(sql`${publicScope} select
      (select count(*)::int from listing_observation_days) as "coverageRows",
      (select min(observation_date)::text from listing_observation_days) as "earliestDate",
      (select coalesce(avg(observation_count),0)::float8 from listing_observation_days) as "averageObservationsPerCoveredListingDay",
      (select count(*)::int from retailer_listings) as "knownListings",
      (select count(*)::int from public_listings) as "publicListings",
      (select count(*)::int from listing_observation_days where observation_date=${today}::date) as "observedToday",
      (select count(*)::int from public_listings p join listing_observation_days d on d.listing_id=p.id where d.observation_date=${today}::date) as "publicObservedToday",
      pg_table_size('listing_observation_days'::regclass)::float8 as "tableBytes",
      pg_indexes_size('listing_observation_days'::regclass)::float8 as "indexBytes"`),
    db.execute(sql`${publicScope} select r.id as retailer,
      count(l.id)::int as known,count(p.id)::int as "expectedPublic",
      count(d.listing_id)::int as "observedToday",
      count(d.listing_id) filter(where p.id is not null)::int as "publicObservedToday"
      from retailers r left join retailer_listings l on l.retailer_id=r.id
      left join public_listings p on p.id=l.id
      left join listing_observation_days d on d.listing_id=l.id and d.observation_date=${today}::date
      group by r.id order by r.id`),
    // Closed local days only. No implied coverage before a listing's first durable evidence.
    db.execute(sql`${publicScope}, beginnings as (
      select p.id,min(d.observation_date) as first_day from public_listings p
      join listing_observation_days d on d.listing_id=p.id group by p.id
    ) select l.retailer_id as retailer,l.external_id as "externalId",day::date::text as day
      from beginnings b join retailer_listings l on l.id=b.id
      cross join lateral generate_series(greatest(b.first_day,${today}::date-7)::timestamp,
        (${today}::date-1)::timestamp,interval '1 day') day
      where not exists(select 1 from listing_observation_days d where d.listing_id=b.id and d.observation_date=day::date)
      order by day desc,l.retailer_id,l.external_id limit 20`),
  ]);
  const total = z
    .object({
      coverageRows: count,
      earliestDate: z.iso.date().nullable(),
      averageObservationsPerCoveredListingDay: z.number().nonnegative(),
      knownListings: count,
      publicListings: count,
      observedToday: count,
      publicObservedToday: count,
      tableBytes: count,
      indexBytes: count,
    })
    .parse(totals.rows[0]);
  const rows = z
    .array(
      z.object({
        retailer: retailerIdSchema,
        known: count,
        expectedPublic: count,
        observedToday: count,
        publicObservedToday: count,
      }),
    )
    .parse(retailers.rows);

  return {
    inspectedAt: now,
    today,
    timeZone: "America/Lima",
    ...total,
    publicMissingToday: total.publicListings - total.publicObservedToday,
    retailers: rows.map((r) => ({
      ...r,
      publicMissingToday: r.expectedPublic - r.publicObservedToday,
    })),
    recentPublicGaps: z
      .array(z.object({ retailer: retailerIdSchema, externalId: z.string(), day: z.iso.date() }))
      .parse(gaps.rows),
    projectedRowsPer30Days: [total.knownListings, catalogPolicy.retainedListingCap, 1500].map(
      (listings) => ({
        listings,
        rows: listings * 30,
      }),
    ),
    note: "Today is still open. Missing coverage is unknown, not proof of a failed request. Gap samples exclude pre-coverage dates; public eligibility is evaluated now.",
  };
}
