import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client.ts";

// Read-only aggregate evidence; no credentials or retailer requests.
try {
  const db = createDatabase();
  const result = await db.execute(sql`with days as (
    select d.*, l.retailer_id,
      h.current_price_cents, h.price_unit,
      exists(select 1 from price_history x where x.listing_id=d.listing_id
        and x.valid_from<=d.last_observed_at and (x.valid_until>d.first_observed_at or x.valid_until is null)
        and (x.current_price_cents<>h.current_price_cents or x.price_unit<>h.price_unit or x.currency<>'PEN')) as mixed
    from listing_observation_days d join retailer_listings l on l.id=d.listing_id
    left join price_history h on h.listing_id=d.listing_id and h.valid_from<=d.last_observed_at
      and (h.valid_until>d.last_observed_at or h.valid_until is null)
  ), depths as (select listing_id,count(*) as days from days group by listing_id)
  select retailer_id,count(*)::int as covered_days,min(observation_date)::text as first_day,
    max(observation_date)::text as last_day,count(distinct listing_id)::int as listings,
    count(*) filter(where current_price_cents>0 and price_unit='UN' and not mixed)::int as comparable_days,
    count(*) filter(where mixed)::int as intraday_mixed_days,
    (select max(days)::int from depths) as maximum_days_per_listing
  from days group by retailer_id order by retailer_id`);
  console.log(
    JSON.stringify(
      {
        inspectedAt: new Date(),
        timeZone: "America/Lima",
        rows: z
          .array(
            z.object({
              retailer_id: z.string(),
              covered_days: z.number().int().nonnegative(),
              first_day: z.iso.date(),
              last_day: z.iso.date(),
              listings: z.number().int().nonnegative(),
              comparable_days: z.number().int().nonnegative(),
              intraday_mixed_days: z.number().int().nonnegative(),
              maximum_days_per_listing: z.number().int().nonnegative(),
            }),
          )
          .parse(result.rows),
      },
      null,
      2,
    ),
  );
} catch {
  console.error("Read-only weekday audit failed; no credentials logged.");
  process.exitCode = 1;
}
