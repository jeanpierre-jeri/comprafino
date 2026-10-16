import { observationDay, shiftObservationDay } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const historyRowsSchema = z.array(
  z.object({
    listingId: z.uuid(),
    date: z.iso.date(),
    priceCents: z.number().int().positive().safe(),
    observedAt: z.coerce.date(),
  }),
);

/** Actual first/last observations and recorded price changes establish samples.
 * No open-state backfill, reference prices, conditional benefits or SKU pooling.
 * Canonical-only saves retain the association cutoff; direct saves own their SKU. */
export function shoppingHistoryRows(
  ids: readonly string[],
  listingIds: readonly string[],
  now: Date,
) {
  const canonicalScope = ids.length
    ? sql`c."canonicalId" in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`,`,
      )})`
    : sql`false`;
  const directScope = listingIds.length
    ? sql`c.listing_id in (${sql.join(
        listingIds.map((id) => sql`${id}::uuid`),
        sql`,`,
      )})`
    : sql`false`;
  const end = observationDay(now);
  const start = shiftObservationDay(end, -89);
  return sql`select coalesce(jsonb_agg(row_to_json(daily)), '[]'::jsonb) from (
    select distinct on (d.listing_id, d.observation_date)
      d.listing_id as "listingId", d.observation_date as date,
      h.current_price_cents as "priceCents", sample.observed_at as "observedAt"
    from current_listings c
    left join canonical_product_listings a on a.listing_id=c.listing_id
    join listing_observation_days d on d.listing_id=c.listing_id
    join price_history h on h.listing_id=d.listing_id
      and h.valid_from<=d.last_observed_at
      and (h.valid_until>d.first_observed_at or h.valid_until is null)
    cross join lateral (values (d.first_observed_at), (d.last_observed_at), (h.valid_from)) sample(observed_at)
    where ((${canonicalScope} and d.first_observed_at>=a.linked_at) or ${directScope})
      and d.observation_date between ${start}::date and ${end}::date
      and sample.observed_at between d.first_observed_at and d.last_observed_at
      and sample.observed_at>=h.valid_from
      and (sample.observed_at<h.valid_until or h.valid_until is null)
      and sample.observed_at<=${now.toISOString()}::timestamptz
      and h.currency='PEN' and h.price_unit='UN' and h.current_price_cents>0
    order by d.listing_id,d.observation_date,h.current_price_cents,sample.observed_at desc
  ) daily`;
}
