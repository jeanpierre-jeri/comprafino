import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** Every accepted listing observation atomically confirms/replaces/removes its
 * benefits. last_seen_at therefore verifies unchanged offers without row churn. */
export function listingOffers(listingId: SQL, observedAt: SQL) {
  return sql`coalesce((select jsonb_agg(jsonb_build_object(
    'conditionType',o.condition_type,'programKey',o.program_key,'conditionLabel',o.condition_label,
    'priceCents',o.price_cents,'observedAt',${observedAt},'startsAt',o.starts_at,'endsAt',o.ends_at)
    order by o.program_key) from retailer_listing_offers o where o.listing_id=${listingId}), '[]'::jsonb)`;
}

export { searchFilters, searchFilterQuery, rankedPrice, priceMode } from "@comprafino/core";

export type { SearchFilters, PriceMode, ConditionalOffer } from "@comprafino/core";
