import { listingOffers } from "./conditional-pricing.ts";
import { conditionalOfferSchema, currentConditionalOffers, rankedPrice } from "@comprafino/core";
import type { PriceMode } from "@comprafino/core";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";
import {
  cheapestOffers,
  offerFreshness,
  matchingVersion,
  meaningfulReferencePrice,
  normalizeSearchQuery,
  retailerIdSchema,
  usefulSearchQuery,
} from "@comprafino/core";
import type { RetailerId } from "@comprafino/core";
import type { createDatabase } from "./client.ts";

export {
  formatPen,
  maximumSearchLength,
  normalizeSearchQuery,
  usefulSearchQuery,
} from "@comprafino/core";
type Database = ReturnType<typeof createDatabase>;
const offerSchema = z.object({
  retailerId: retailerIdSchema,
  retailerName: z.string().min(1),
  title: z.string().min(1),
  url: z.string(),
  imageUrl: z.string().nullable(),
  currentPriceCents: z.number().int().nonnegative(),
  regularPriceCents: z.number().int().nonnegative().nullable(),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable().optional(),
  conditionalOffers: z.array(conditionalOfferSchema).default([]),
});
const productSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1),
  brand: z.string().min(1),
  quantityValue: z.number().int().positive(),
  quantityUnit: z.enum(["g", "ml", "unit"]),
  packageCount: z.number().int().positive(),
  offers: z.array(offerSchema).min(2),
});
export type RetailerOffer = z.infer<typeof offerSchema> & {
  freshness: ReturnType<typeof offerFreshness>;
  ranking: ReturnType<typeof rankedPrice>;
};
export type ProductComparison = Omit<z.infer<typeof productSchema>, "offers"> & {
  offers: RetailerOffer[];
  imageUrl: string | null;
  retailerCount: number;
  lowestPriceCents: number | null;
  cheapestRetailers: string[];
  bestRanking: { priceCents: number; retailers: string[]; conditions: string[] } | null;
  lowestBenefit: { priceCents: number; retailers: string[]; conditions: string[] } | null;
};
const retailerHosts: Record<RetailerId, string> = {
  tottus: "www.tottus.com.pe",
  "plaza-vea": "www.plazavea.com.pe",
  metro: "www.metro.pe",
};
const productImageHosts = [
  "media.tottus.com.pe",
  "plazavea.vteximg.com.br",
  "metroio.vteximg.com.br",
] as const;
function trustedUrl(raw: string | null, hosts: readonly string[]): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function retailerProductUrl(
  offer: Pick<RetailerOffer, "retailerId" | "url">,
): string | null {
  return trustedUrl(offer.url, [retailerHosts[offer.retailerId]]);
}
export function productImageUrl(raw: string | null): string | null {
  const trusted = trustedUrl(raw, productImageHosts);
  if (!trusted) return null;
  const url = new URL(trusted);
  const prefix = url.hostname === "media.tottus.com.pe" ? "/tottusPE/" : "/arquivos/ids/";
  return url.pathname.startsWith(prefix) ? trusted : null;
}
export function publicProduct(
  raw: unknown,
  now = new Date(),
  mode: PriceMode = "standard",
): ProductComparison {
  const product = productSchema.parse(raw);
  const offers = product.offers
    .filter((offer) => offer.currentPriceCents > 0)
    .map((offer): RetailerOffer => ({
      ...offer,
      freshness: offerFreshness(offer.observedAt, now),
      conditionalOffers:
        offer.available === false || offerFreshness(offer.observedAt, now) !== "fresh"
          ? []
          : currentConditionalOffers(offer.conditionalOffers, now),
      ranking: rankedPrice(
        offer.currentPriceCents,
        offer.available === false || offerFreshness(offer.observedAt, now) !== "fresh"
          ? []
          : offer.conditionalOffers,
        mode,
        now,
      ),
      regularPriceCents: meaningfulReferencePrice(offer.currentPriceCents, offer.regularPriceCents),
      imageUrl: productImageUrl(offer.imageUrl),
    }))
    .sort(
      (a, b) =>
        a.currentPriceCents - b.currentPriceCents || a.retailerId.localeCompare(b.retailerId),
    );
  // Image choice is independent of price changes: lexical retailer order wins.
  const imageUrl =
    [...offers]
      .sort((a, b) => a.retailerId.localeCompare(b.retailerId))
      .find((offer) => offer.imageUrl)?.imageUrl ?? null;
  const cheapest = cheapestOffers(offers, now);
  const ranked = offers
    .filter((o) => o.freshness === "fresh" && o.available !== false)
    .sort((a, b) => a.ranking.priceCents - b.ranking.priceCents);
  const rankedTies = ranked.filter((o) => o.ranking.priceCents === ranked[0]?.ranking.priceCents);
  const benefits = offers
    .filter((o) => o.freshness === "fresh" && o.available !== false)
    .flatMap((o) => o.conditionalOffers.map((b) => ({ ...b, retailerName: o.retailerName })))
    .sort((a, b) => a.priceCents - b.priceCents);
  const lowest = benefits[0]?.priceCents;
  const ties = benefits.filter((b) => b.priceCents === lowest);
  return {
    ...product,
    bestRanking: ranked[0]
      ? {
          priceCents: ranked[0].ranking.priceCents,
          retailers: rankedTies.map((o) => o.retailerName),
          conditions: [
            ...new Set(
              rankedTies.flatMap((o) =>
                o.ranking.condition ? [o.ranking.condition.conditionLabel] : [],
              ),
            ),
          ],
        }
      : null,
    lowestBenefit:
      lowest === undefined
        ? null
        : {
            priceCents: lowest,
            retailers: ties.map((b) => b.retailerName),
            conditions: [...new Set(ties.map((b) => b.conditionLabel))],
          },
    offers,
    imageUrl,
    retailerCount: offers.length,
    lowestPriceCents: cheapest[0]?.currentPriceCents ?? null,
    cheapestRetailers: cheapest.map((offer) => offer.retailerName),
  };
}
/** SQL counterpart of normalizeSearchQuery; letters, accents and numbers survive. */
export function searchText(text: SQL): SQL {
  return sql`trim(regexp_replace(regexp_replace(regexp_replace(lower(normalize(${text}, NFKC)),
    '([0-9])([[:alpha:]])', '\\1 \\2', 'g'), '([[:alpha:]])([0-9])', '\\1 \\2', 'g'),
    '[^[:alnum:]]+', ' ', 'g'))`;
}
// No review table or unmatched listing participates. Reject groups with a manual,
// obsolete-version or below-auto-confidence link, even if two other links qualify.
export const eligibleProducts = sql`with offers as (
  select a.canonical_product_id, r.id as retailer_id, r.name as retailer_name,
    l.title, l.url, l.image_url, l.last_seen_at, l.available, n.brand, n.normalized_title,
    h.current_price_cents, h.regular_price_cents,
    ${listingOffers(sql`l.id`, sql`l.last_seen_at`)} as conditional_offers
  from canonical_product_listings a
  join retailer_listings l on l.id=a.listing_id and l.retailer_id=a.retailer_id
  join retailers r on r.id=l.retailer_id
  join listing_normalizations n on n.listing_id=l.id
  join price_history h on h.listing_id=l.id and h.valid_until is null
  where a.method='automatic' and a.matching_version=${matchingVersion} and a.confidence>=0.90
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
    and (a.method<>'automatic' or a.matching_version<>${matchingVersion} or a.confidence<0.90))
  group by c.id having count(distinct o.retailer_id)>=2
)`;
const publicColumns = sql`id,"displayName",brand,"quantityValue","quantityUnit","packageCount",offers`;
export async function searchCanonicalProducts(
  db: Database,
  rawQuery: string,
  now = new Date(),
): Promise<ProductComparison[]> {
  if (!usefulSearchQuery(rawQuery)) return [];
  const query = normalizeSearchQuery(rawQuery);
  const tokens = [...new Set(query.split(" "))];
  // All terms must be present. Prefixes are allowed for words; numbers are exact.
  // Trigrams rank admitted results only, so fuzziness cannot discard variant terms.
  const predicates = tokens.map(
    (token) => sql`exists (
    select 1 from unnest(string_to_array(identity_text,' ')) word
    where ${/^\d+$/u.test(token) ? sql`word=${token}` : sql`starts_with(word,${token})`}
  )`,
  );
  const [result] = await db.batch([
    db.execute(sql`${eligibleProducts}
    select ${publicColumns} from products where ${sql.join(predicates, sql` and `)}
    order by (title_text=${query}) desc, starts_with(title_text,${query}) desc,
      (brand_text=${query}) desc,
      greatest(public.similarity(title_text,${query}),
        (select max(public.similarity(t,${query})) from unnest(retailer_titles) t)) desc,
      "displayName" collate "C", id limit 20`),
  ]);
  return z
    .array(z.unknown())
    .parse(result.rows)
    .map((row) => publicProduct(row, now));
}
export function isPublicProductId(id: string): boolean {
  return z.uuid().safeParse(id).success;
}
export async function getCanonicalProductComparison(
  db: Database,
  id: string,
  now = new Date(),
  mode: PriceMode = "standard",
): Promise<ProductComparison | null> {
  if (!isPublicProductId(id)) return null;
  const [result] = await db.batch([
    db.execute(sql`${eligibleProducts}
    select ${publicColumns} from products where id=${id}::uuid`),
  ]);
  const rows = z.array(z.unknown()).parse(result.rows);
  return rows.length ? publicProduct(rows[0], now, mode) : null;
}
