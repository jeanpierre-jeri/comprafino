import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  historyWindow,
  parseHistoryRange,
  retailerIdSchema,
  summarizePriceHistory,
} from "@comprafino/core";
import type { HistoryRange } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import { eligibleProducts, isPublicProductId } from "./public-products.ts";

const stateSchema = z.object({
  priceCents: z.number().int().nonnegative(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date().nullable(),
  previousPriceCents: z.number().int().nonnegative().nullable(),
  previousValidUntil: z.coerce.date().nullable(),
});
const rowSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  retailerId: retailerIdSchema,
  retailerName: z.string(),
  lastObservedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  states: z.array(stateSchema),
});
/** One bounded query; public exact-product eligibility is shared with comparison. */
export async function getCanonicalProductPriceHistory(
  db: ReturnType<typeof createDatabase>,
  productId: string,
  options: { range?: HistoryRange; now?: Date } = {},
) {
  if (!isPublicProductId(productId)) return null;
  const range = parseHistoryRange(options.range);
  const { start, end } = historyWindow(range, options.now);
  const [result] = await db.batch([
    db.execute(sql`${eligibleProducts}, scoped as (
    select p.id,p."displayName",a.listing_id,r.id as retailer_id,r.name as retailer_name,l.last_seen_at,l.available
    from products p join canonical_product_listings a on a.canonical_product_id=p.id
    join retailer_listings l on l.id=a.listing_id and l.retailer_id=a.retailer_id
    join retailers r on r.id=a.retailer_id
    join listing_normalizations n on n.listing_id=l.id
    join price_history current on current.listing_id=l.id and current.valid_until is null
    where p.id=${productId}::uuid and l.active and current.currency='PEN' and current.price_unit='UN'
  ), ranged as (
    select s.*,h.current_price_cents,h.valid_from,h.valid_until,
      previous.current_price_cents as previous_price,previous.valid_until as previous_until
    from scoped s join price_history h on h.listing_id=s.listing_id
    left join lateral (
      select prior.current_price_cents,prior.valid_until from price_history prior
      where prior.listing_id=h.listing_id and prior.valid_from<h.valid_from
        and prior.currency='PEN' and prior.price_unit='UN'
      order by prior.valid_from desc limit 1
    ) previous on true
    where h.currency='PEN' and h.price_unit='UN' and h.valid_from<=${end.toISOString()}::timestamptz
      and (h.valid_until>${start.toISOString()}::timestamptz or h.valid_until is null)
  ) select s.id,s."displayName",s.retailer_id as "retailerId",s.retailer_name as "retailerName",
    s.last_seen_at as "lastObservedAt",s.available,
    coalesce(jsonb_agg(jsonb_build_object('priceCents',h.current_price_cents,'validFrom',h.valid_from,
      'validUntil',h.valid_until,'previousPriceCents',h.previous_price,'previousValidUntil',h.previous_until)
      order by h.valid_from) filter(where h.valid_from is not null),'[]'::jsonb) as states
    from scoped s left join ranged h on h.listing_id=s.listing_id
    group by s.id,s."displayName",s.retailer_id,s.retailer_name,s.last_seen_at,s.available
    order by s.retailer_id`),
  ]);
  const rows = z.array(rowSchema).parse(result.rows);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    displayName: rows[0].displayName,
    range,
    start,
    end,
    retailers: rows.map((row) => ({
      ...row,
      summary: summarizePriceHistory(row.states, start, end, row.lastObservedAt),
    })),
  };
}
export type CanonicalProductPriceHistory = NonNullable<
  Awaited<ReturnType<typeof getCanonicalProductPriceHistory>>
>;
