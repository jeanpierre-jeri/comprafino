import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client.ts";
import { getCanonicalProductComparison, eligibleProducts } from "./public-products.ts";
import { getCanonicalProductPriceHistory } from "./price-history.ts";
const db = createDatabase();
const now = new Date();
const [depth, candidates, counts, transitions, sparse] = await db.batch([
  db.execute(sql`select count(*)::int as states,count(distinct listing_id)::int as listings,
    min(valid_from) as oldest,max(valid_from) as newest,count(*) filter(where valid_until is null)::int as open
    from price_history`),
  db.execute(sql`${eligibleProducts} select p.id,p."displayName",count(h.id)::int as states
    from products p join canonical_product_listings a on a.canonical_product_id=p.id
    join price_history h on h.listing_id=a.listing_id group by p.id,p."displayName"
    order by count(h.id) desc,p.id limit 5`),
  db.execute(sql`with ordered as (select listing_id,current_price_cents,valid_from,valid_until,
      lag(current_price_cents) over(partition by listing_id order by valid_from) as prior_price,
      lag(valid_from) over(partition by listing_id order by valid_from) as prior_start from price_history)
    select count(*) filter(where prior_price is not null and prior_price<>current_price_cents)::int as ordinary_changes,
      count(*) filter(where prior_price is not null and prior_price=current_price_cents)::int as other_state_changes,
      count(*) filter(where valid_from-prior_start>interval '36 hours')::int as widely_spaced_state_starts,
      (select count(*)::int from (select listing_id from price_history group by listing_id having count(*)=1) one_state) as single_state_listings
    from ordered`),
  db.execute(sql`with ordered as (select listing_id,current_price_cents,valid_from,
    lag(current_price_cents) over(partition by listing_id order by valid_from) as prior_price from price_history)
    select l.title,l.retailer_id,l.external_id,o.prior_price,o.current_price_cents,o.valid_from,
      a.canonical_product_id from ordered o join retailer_listings l on l.id=o.listing_id
      left join canonical_product_listings a on a.listing_id=l.id
      where o.prior_price is not null and o.prior_price<>o.current_price_cents order by o.valid_from limit 10`),
  db.execute(sql`${eligibleProducts} select p.id,p."displayName",count(h.id)::int as states
    from products p join canonical_product_listings a on a.canonical_product_id=p.id
    join price_history h on h.listing_id=a.listing_id group by p.id,p."displayName"
    having count(h.id)=count(distinct a.listing_id) order by p.id limit 1`),
]);
const depthRow = z
  .object({
    states: z.number(),
    listings: z.number(),
    oldest: z.coerce.date(),
    newest: z.coerce.date(),
    open: z.number(),
  })
  .parse(depth.rows[0]);
const countRow = z
  .object({
    ordinary_changes: z.number(),
    other_state_changes: z.number(),
    widely_spaced_state_starts: z.number(),
    single_state_listings: z.number(),
  })
  .parse(counts.rows[0]);
const ids = z
  .array(z.object({ id: z.uuid(), displayName: z.string(), states: z.number() }))
  .parse([...candidates.rows, ...sparse.rows]);
const products = [];
for (const product of ids) {
  const comparison = await getCanonicalProductComparison(db, product.id, now);
  const ranges = [];
  for (const range of ["7d", "30d", "90d"] as const) {
    const history = await getCanonicalProductPriceHistory(db, product.id, { range, now });
    if (!history || !comparison) throw new Error("Audited product is no longer public");
    for (const retailer of history.retailers) {
      const offer = comparison.offers.find((o) => o.retailerId === retailer.retailerId);
      if (!offer) throw new Error("History retailer missing from comparison");
      const expectedCurrent =
        offer.observedAt >= history.start && offer.observedAt <= history.end
          ? offer.currentPriceCents
          : null;
      if (retailer.summary.currentPriceCents !== expectedCurrent)
        throw new Error("History/current comparison mismatch");
    }
    ranges.push({
      range,
      retailers: history.retailers.map((r) => ({
        retailer: r.retailerName,
        lastObservedAt: r.lastObservedAt,
        currentOfferCents: comparison.offers.find((o) => o.retailerId === r.retailerId)
          ?.currentPriceCents,
        ...r.summary,
      })),
    });
  }
  products.push({ ...product, ranges });
}
console.log(
  JSON.stringify(
    {
      auditedAt: now,
      depth: depthRow,
      counts: countRow,
      representativeChanges: z
        .array(
          z.object({
            title: z.string(),
            retailer_id: z.string(),
            external_id: z.string(),
            prior_price: z.number(),
            current_price_cents: z.number(),
            valid_from: z.coerce.date(),
            canonical_product_id: z.uuid().nullable(),
          }),
        )
        .parse(transitions.rows),
      gapEvidence:
        "Only state starts and latest listing observation survive; actual historical coverage/gaps cannot be reconstructed. Widely spaced starts are not verified gaps.",
      products,
    },
    null,
    2,
  ),
);
