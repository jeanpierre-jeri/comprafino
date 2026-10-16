// Frozen pre-03C SQL oracle for real PostgreSQL equivalence tests only.
// Keep independent of the optimized eligibility fragments so a changed gate
// cannot make both sides of the regression pass together.
import { matchingThresholds, matchingVersion } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { listingOffers } from "../conditional-pricing.ts";
import { searchText } from "../public-products.ts";

// No review table or unmatched listing participates. Reject groups with a manual,
// obsolete-version or below-auto-confidence link, even if two other links qualify.
export const legacyEligibleProducts = sql`with offers as (
  select a.canonical_product_id, l.id as listing_id, r.id as retailer_id, r.name as retailer_name,
    l.title, l.url, l.image_url, l.last_seen_at, l.available, n.brand, n.normalized_title,
    h.current_price_cents, h.regular_price_cents,
    ${listingOffers(sql`l.id`, sql`l.last_seen_at`)} as conditional_offers
  from canonical_product_listings a
  join retailer_listings l on l.id=a.listing_id and l.retailer_id=a.retailer_id
  join retailers r on r.id=l.retailer_id
  join listing_normalizations n on n.listing_id=l.id
  join price_history h on h.listing_id=l.id and h.valid_until is null
  where a.method='automatic' and a.matching_version=${matchingVersion} and a.confidence>=${matchingThresholds.auto}
    and l.active and h.currency='PEN' and h.price_unit='UN' and h.current_price_cents>0
), products as (
  select c.id, c.display_name as "displayName", c.brand_key,
    c.quantity_value as "quantityValue", c.quantity_unit as "quantityUnit", c.package_count as "packageCount",
    coalesce(min(o.brand),c.brand_key) as brand,
    ${searchText(sql`c.display_name`)} as title_text,
    ${searchText(sql`c.brand_key`)} as brand_text,
    ${searchText(sql`c.display_name || ' ' || c.brand_key || ' ' || string_agg(o.normalized_title, ' ')`)} as identity_text,
    jsonb_agg(jsonb_build_object('retailerId',o.retailer_id,'retailerName',o.retailer_name,
      'title',o.title,'url',o.url,'imageUrl',o.image_url,'currentPriceCents',o.current_price_cents,
      'regularPriceCents',o.regular_price_cents,'observedAt',o.last_seen_at,'available',o.available,'conditionalOffers',o.conditional_offers) order by o.retailer_id) as offers,
    array_agg(${searchText(sql`o.normalized_title`)}) as retailer_titles
  from canonical_products c join offers o on o.canonical_product_id=c.id
  where not exists (select 1 from canonical_product_listings a where a.canonical_product_id=c.id
    and (a.method<>'automatic' or a.matching_version<>${matchingVersion} or a.confidence<${matchingThresholds.auto}))
  group by c.id having count(distinct o.retailer_id)>=2
)`;
