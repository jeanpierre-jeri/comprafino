import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  calculateUnitPrice,
  unitPriceBases,
  classifyProductFamily,
  resolveProductFamilyQuery,
  selectFamilyOffers,
  compareUnitPrices,
  genericOfferSort,
  normalizeSearchQuery,
  normalizeCatalogListing,
  normalizationVersion,
  retailerIdSchema,
  usefulSearchQuery,
} from "@comprafino/core";
import type { GenericOfferSort } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import { catalogFingerprint, catalogRecordSchema } from "./catalog.ts";
import {
  eligibleProducts,
  productImageUrl,
  retailerProductUrl,
  searchCanonicalProducts,
  searchText,
} from "./public-products.ts";
export {
  calculateUnitPrice,
  formatUnitPrice,
  genericOfferSort,
  unitPriceBases,
  unitPriceBasisLabel,
} from "@comprafino/core";
const rowSchema = z.object({
  listing: catalogRecordSchema,
  sourceCategory: z.string().nullable().optional(),
  retailerName: z.string().min(1),
  url: z.string(),
  imageUrl: z.string().nullable(),
  currentPriceCents: z.number().int().nonnegative(),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  fingerprint: z.string(),
  version: z.number().int(),
  canonicalId: z.uuid().nullable(),
  retailerCount: z.number().int().nonnegative(),
});
export function genericProductOffer(raw: unknown, now = new Date()) {
  const row = rowSchema.parse(raw);
  if (row.version !== normalizationVersion || row.fingerprint !== catalogFingerprint(row.listing))
    return null;
  const retailerId = retailerIdSchema.parse(row.listing.retailerId);
  const url = retailerProductUrl({ retailerId, url: row.url });
  if (!url || !row.listing.title.trim()) return null;
  const attributes = normalizeCatalogListing(row.listing);
  const family = classifyProductFamily({
    title: row.listing.title,
    retailerId,
    sourceCategory: row.sourceCategory,
  });
  const calculation = calculateUnitPrice(
    {
      ...attributes,
      title: row.listing.title,
      productFamily: family.family,
      currentPriceCents: row.currentPriceCents,
      observedAt: row.observedAt,
      available: row.available,
    },
    now,
  );
  if (calculation.reason === "not-fresh" || calculation.reason === "unavailable") return null;
  return {
    id: row.listing.id,
    title: row.listing.title,
    family,
    sourceCategory: row.sourceCategory ?? null,
    retailerId,
    retailerName: row.retailerName,
    brand: attributes.brand,
    quantity: attributes.quantity,
    packageCount: attributes.packageCount,
    totalQuantity: attributes.totalQuantity,
    pricingBasis: attributes.pricingBasis,
    currentPriceCents: row.currentPriceCents,
    observedAt: row.observedAt,
    url,
    imageUrl: productImageUrl(row.imageUrl),
    canonicalId: row.canonicalId,
    retailerCount: row.retailerCount,
    unitPrice: calculation.price,
    unitPriceUnavailableReason: calculation.reason,
  };
}
export type GenericProductOffer = NonNullable<ReturnType<typeof genericProductOffer>>;

export function sortGenericOffers(offers: readonly GenericProductOffer[], sort: GenericOfferSort) {
  // SQL order is relevance; stable sorting retains it as the tie-breaker.
  return [...offers].sort((a, b) => {
    if (sort === "total-price") {
      // A KG quote is not a package total; keep direct quotes in a separate block.
      return (
        Number(a.pricingBasis === "kg") - Number(b.pricingBasis === "kg") ||
        a.currentPriceCents - b.currentPriceCents
      );
    }
    if (sort !== "unit-price") return 0;
    if (!a.unitPrice || !b.unitPrice) return Number(!a.unitPrice) - Number(!b.unitPrice);
    return (
      unitPriceBases.indexOf(a.unitPrice.basis) - unitPriceBases.indexOf(b.unitPrice.basis) ||
      compareUnitPrices(a.unitPrice, b.unitPrice)
    );
  });
}
/** Reserve room for every present dimension and unknown quantities before filling
 * spare capacity. The global bound must not hide all litres behind mass results. */
export function limitGenericOffers(offers: readonly GenericProductOffer[], sort: GenericOfferSort) {
  const sorted = sortGenericOffers(offers, sort);
  if (sort !== "unit-price" || sorted.length <= 30) return sorted.slice(0, 30);
  const groups = [...new Set(sorted.map((o) => o.unitPrice?.basis ?? "unknown"))];
  const quota = Math.floor(30 / groups.length);
  const selected = new Set<GenericProductOffer>();
  for (const group of groups)
    for (const offer of sorted
      .filter((o) => (o.unitPrice?.basis ?? "unknown") === group)
      .slice(0, quota))
      selected.add(offer);
  for (const offer of sorted) {
    if (selected.size >= 30) break;
    selected.add(offer);
  }
  return sorted.filter((o) => selected.has(o));
}
export async function searchGenericProductOffers(
  db: ReturnType<typeof createDatabase>,
  rawQuery: string,
  sort: GenericOfferSort = "relevance",
  now = new Date(),
): Promise<GenericProductOffer[]> {
  if (!usefulSearchQuery(rawQuery)) return [];
  const query = normalizeSearchQuery(rawQuery);
  const interpretation = resolveProductFamilyQuery(rawQuery);
  const requiredQuery = interpretation?.remainingQuery ?? query;
  const predicates = [...new Set(requiredQuery.split(" ").filter(Boolean))].map(
    (token) =>
      sql`exists (select 1 from unnest(string_to_array(identity_text,' ')) word where ${/^\d+$/u.test(token) ? sql`word=${token}` : sql`starts_with(word,${token})`})`,
  );
  const [result] = await db.batch([
    db.execute(sql`${eligibleProducts}, generic as (
    select jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,
      'priceUnit',h.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,
      'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,
      l.category as "sourceCategory", r.name as "retailerName", l.url, l.image_url as "imageUrl", h.current_price_cents as "currentPriceCents",
      l.last_seen_at as "observedAt", l.available, n.input_fingerprint as fingerprint, n.normalization_version as version,
      p.id as "canonicalId", coalesce(jsonb_array_length(p.offers),0) as "retailerCount",
      ${searchText(sql`n.normalized_title`)} as title_text,
      ${searchText(sql`n.normalized_title || ' ' || coalesce(n.brand,'')`)} as identity_text
    from retailer_listings l join retailers r on r.id=l.retailer_id
    join listing_normalizations n on n.listing_id=l.id
    join price_history h on h.listing_id=l.id and h.valid_until is null
    left join canonical_product_listings a on a.listing_id=l.id
    left join products p on p.id=a.canonical_product_id
    where l.active and l.available is distinct from false and h.currency='PEN'
      and h.price_unit=l.price_unit and h.price_unit in ('UN','KG')
      and l.last_seen_at between ${new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString()}::timestamptz and ${now.toISOString()}::timestamptz
  ) select * from generic where ${predicates.length ? sql.join(predicates, sql` and `) : sql`true`}
  order by (title_text=${query}) desc, starts_with(title_text,${query}) desc,
    public.similarity(title_text,${query}) desc, title_text collate "C", listing->>'id' limit 1001`),
  ]);
  // Current catalog already has a 1000-row operational guard. Refuse truncation:
  // lowest-price modes must consider every admitted candidate before limiting.
  if (result.rows.length > 1000) throw new Error("Generic search candidate bound exceeded");
  const offers = result.rows
    .map((row) => genericProductOffer(row, now))
    .filter((offer) => offer !== null);
  return limitGenericOffers(
    interpretation ? selectFamilyOffers(offers, interpretation.family) : offers,
    genericOfferSort(sort),
  );
}
export async function searchPublicProducts(
  db: ReturnType<typeof createDatabase>,
  query: string,
  sort: GenericOfferSort = "relevance",
  now = new Date(),
) {
  const [products, offers] = await Promise.all([
    searchCanonicalProducts(db, query, now),
    searchGenericProductOffers(db, query, sort, now),
  ]);
  // Exact comparison identity/routes remain unchanged. In a recognized family
  // search, an incidental ingredient in an exact group is not useful coverage.
  const interpretation = resolveProductFamilyQuery(query);
  const relevantProducts = interpretation
    ? products.filter((product) =>
        product.offers.some(
          (offer) => classifyProductFamily({ title: offer.title }).family === interpretation.family,
        ),
      )
    : products;
  return {
    products: relevantProducts,
    offers,
    usefulResultCount: relevantProducts.length + offers.length,
  };
}
