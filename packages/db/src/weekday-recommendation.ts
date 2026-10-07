import { sql } from "drizzle-orm";
import { z } from "zod";
import { weekdayEvidenceWindow } from "@comprafino/core";
import type { SQL } from "drizzle-orm";

/** Runs inside the existing bounded shopping snapshot. History is restricted to
 * requested exact products and current public candidates. No generic attribution,
 * conditional prices, state-start coverage or missing-date backfill. */
export function shoppingWeekdayRows(ids: readonly string[], now: Date): SQL {
  const { start, end } = weekdayEvidenceWindow(now);
  const scope = ids.length
    ? sql`a.canonical_product_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql`false`;

  return sql`select coalesce(jsonb_agg(jsonb_build_object(
    'listingId',d.listing_id,'date',d.observation_date,'priceCents',
    case when h.current_price_cents>0 and h.currency='PEN' and h.price_unit='UN'
      and exists(select 1 from price_history first_state where first_state.listing_id=d.listing_id
        and first_state.valid_from<=d.first_observed_at
        and (first_state.valid_until>d.first_observed_at or first_state.valid_until is null))
      and not exists(select 1 from price_history gap where gap.listing_id=d.listing_id
        and gap.valid_until>d.first_observed_at and gap.valid_until<=d.last_observed_at
        and not exists(select 1 from price_history next_state where next_state.listing_id=gap.listing_id
          and next_state.valid_from=gap.valid_until))
      and not exists(select 1 from price_history x where x.listing_id=d.listing_id
        and x.valid_from<=d.last_observed_at and (x.valid_until>d.first_observed_at or x.valid_until is null)
        and (x.current_price_cents<>h.current_price_cents or x.currency<>'PEN' or x.price_unit<>'UN'))
      then h.current_price_cents else null end)), '[]'::jsonb)
    from canonical_product_listings a join products p on p.id=a.canonical_product_id
    join current_listings c on (c.listing->>'id')::uuid=a.listing_id
    join listing_observation_days d on d.listing_id=a.listing_id
    left join price_history h on h.listing_id=d.listing_id and h.valid_from<=d.last_observed_at
      and (h.valid_until>d.last_observed_at or h.valid_until is null)
    where ${scope} and d.observation_date between ${start}::date and ${end}::date
      and d.first_observed_at>=a.linked_at and d.last_observed_at<=${now.toISOString()}::timestamptz`;
}

export const weekdayRowsSchema = z.array(
  z.object({
    listingId: z.uuid(),
    date: z.iso.date(),
    priceCents: z.number().int().positive().safe().nullable(),
  }),
);
