import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  calculateUnitPrice,
  classifyProductFamily,
  conditionalOfferSchema,
  currentConditionalOffers,
  meaningfulReferencePrice,
  normalizeCatalogListing,
  normalizationVersion,
  offerFreshness,
  retailerIdSchema,
} from "@comprafino/core";
import type { HistoryRange } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import { catalogFingerprint, catalogRecordSchema } from "./catalog.ts";
import {
  eligibleProducts,
  isPublicProductId,
  productImageUrl,
  retailerProductUrl,
} from "./public-products.ts";
import { listingOffers } from "./conditional-pricing.ts";
import { getScopedPriceHistory } from "./price-history.ts";

const detailSchema = z.object({
  listing: catalogRecordSchema,
  retailerName: z.string().min(1),
  url: z.string(),
  imageUrl: z.string().nullable(),
  sourceCategory: z.string().nullable(),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  active: z.boolean(),
  open: z.boolean(),
  currentPriceCents: z.number().int().positive(),
  regularPriceCents: z.number().int().nonnegative().nullable(),
  fingerprint: z.string(),
  version: z.number().int(),
  canonicalId: z.uuid().nullable(),
  conditionalOffers: z.array(conditionalOfferSchema),
});
/** Safe public metadata only. Review status and normalization internals never leave this boundary. */
export function publicRetailerListing(raw: unknown, now = new Date()) {
  const parsed = detailSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  if (
    !row.active ||
    row.version !== normalizationVersion ||
    row.fingerprint !== catalogFingerprint(row.listing) ||
    !row.listing.title.trim()
  )
    return null;
  const retailerId = retailerIdSchema.parse(row.listing.retailerId);
  const url = retailerProductUrl({ retailerId, url: row.url });
  if (!url) return null;
  const attributes = normalizeCatalogListing(row.listing);
  const family = classifyProductFamily({
    title: row.listing.title,
    retailerId,
    sourceCategory: row.sourceCategory,
  });
  const observedAt = row.observedAt;
  const freshness = offerFreshness(observedAt, now);
  const current = row.open && freshness === "fresh" && row.available !== false;
  const calculation = calculateUnitPrice(
    {
      ...attributes,
      title: row.listing.title,
      productFamily: family.family,
      currentPriceCents: row.currentPriceCents,
      observedAt,
      available: row.open ? row.available : false,
    },
    now,
  );
  return {
    id: row.listing.id,
    title: row.listing.title,
    retailerId,
    retailerName: row.retailerName,
    brand: attributes.brand,
    quantity: attributes.quantity,
    packageCount: attributes.packageCount,
    totalQuantity: attributes.totalQuantity,
    pricingBasis: attributes.pricingBasis,
    family,
    url,
    imageUrl: productImageUrl(row.imageUrl),
    observedAt,
    freshness,
    available: row.available,
    current,
    historicalOnly: !row.open || freshness === "too-stale",
    currentPriceCents: row.currentPriceCents,
    regularPriceCents: meaningfulReferencePrice(row.currentPriceCents, row.regularPriceCents),
    conditionalOffers: current ? currentConditionalOffers(row.conditionalOffers, now) : [],
    canonicalId: row.canonicalId,
    unitPrice: calculation.price,
    unitPriceUnavailableReason: calculation.reason,
  };
}

/** Bounded to one UUID; closed ordinary states remain historical, never current. */
export async function getPublicRetailerListingDetail(
  db: ReturnType<typeof createDatabase>,
  listingId: string,
  options: { range?: HistoryRange; now?: Date } = {},
) {
  if (!isPublicProductId(listingId)) return null;
  const now = options.now ?? new Date();
  const [result] = await db.batch([
    db.execute(
      sql`${eligibleProducts} ${publicListingDetailRows(sql`l.id=${listingId}::uuid`, now)}`,
    ),
  ]);
  const listing = publicRetailerListing(result.rows[0], now);
  if (!listing) return null;
  const history = await getScopedPriceHistory(
    db,
    sql`with scoped as (
    select l.id,l.title as "displayName",l.id as listing_id,r.id as retailer_id,
      r.name as retailer_name,l.last_seen_at,l.available,l.price_unit
    from retailer_listings l join retailers r on r.id=l.retailer_id where l.id=${listingId}::uuid
  )`,
    { ...options, now },
  );
  return { ...listing, history };
}

/** Shared validated projection for the read-only audit; callers supply a bounded predicate. */
export function publicListingDetailRows(predicate: import("drizzle-orm").SQL, now: Date) {
  return sql`
    select jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,
      'priceUnit',l.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,
      'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,
      r.name as "retailerName",l.url,l.image_url as "imageUrl",l.category as "sourceCategory",
      l.last_seen_at as "observedAt",l.available,l.active,h.valid_until is null as open,
      h.current_price_cents as "currentPriceCents",h.regular_price_cents as "regularPriceCents",
      n.input_fingerprint as fingerprint,n.normalization_version as version,p.id as "canonicalId",
      ${listingOffers(sql`l.id`, sql`l.last_seen_at`)} as "conditionalOffers"
    from retailer_listings l join retailers r on r.id=l.retailer_id
    join listing_normalizations n on n.listing_id=l.id
    join lateral (select * from price_history h where h.listing_id=l.id
      order by h.valid_from desc limit 1) h on true
    left join canonical_product_listings a on a.listing_id=l.id
    left join products p on p.id=a.canonical_product_id
    where ${predicate} and l.active and h.currency='PEN'
      and h.price_unit=l.price_unit and h.price_unit in ('UN','KG')
      and h.valid_from<=${now.toISOString()}::timestamptz`;
}
