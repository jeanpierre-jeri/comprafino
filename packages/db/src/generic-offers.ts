import { groupSearchOffers, limitGenericOffers } from "@comprafino/core";
import { listingRefreshPolicy } from "@comprafino/core";
import { catalogPolicy } from "@comprafino/core";
import { usefulSearchRequest } from "@comprafino/core";
import { categoryListingPredicate } from "./search-categories.ts";
import { listingOffers } from "./conditional-pricing.ts";
import {
  conditionalOfferSchema,
  currentConditionalOffers,
  rankedPrice,
  searchFilters,
} from "@comprafino/core";
import type { PriceMode, SearchFilters, SearchCategoryId } from "@comprafino/core";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { ProductFamily } from "@comprafino/core";
import { z } from "zod";
import {
  calculateUnitPrice,
  meaningfulReferencePrice,
  classifyProductFamily,
  resolveProductFamilyQuery,
  selectFamilyOffers,
  familySearchEvidence,
  missingDiscoveryRetailers,
  genericOfferSort,
  normalizeSearchQuery,
  prioritizeWholeWordSearchResults,
  normalizeCatalogListing,
  normalizationVersion,
  retailerIdSchema,
  usefulSearchQuery,
} from "@comprafino/core";
import type { GenericOfferSort } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import type { CurrentPriceSource, ProductComparison } from "./public-products.ts";
import { catalogFingerprint, catalogRecordSchema } from "./catalog.ts";
import {
  publicProduct,
  eligibleProductIdentities,
  currentPriceJoin,
  productImageUrl,
  retailerProductUrl,
  searchCanonicalProducts,
  searchText,
} from "./public-products.ts";

export {
  sortGenericOffers,
  limitGenericOffers,
  unitPriceBases,
  calculateUnitPrice,
  formatUnitPrice,
  genericOfferSort,
  unitPriceBasisLabel,
} from "@comprafino/core";

const rowSchema = z.object({
  listing: catalogRecordSchema,
  sourceCategory: z.string().nullable().optional(),
  retailerName: z.string().min(1),
  url: z.string(),
  imageUrl: z.string().nullable(),
  currentPriceCents: z.number().int().nonnegative(),
  regularPriceCents: z.number().int().nonnegative().nullable().optional(),
  conditionalOffers: z.array(conditionalOfferSchema).default([]),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  fingerprint: z.string(),
  version: z.number().int(),
  canonicalId: z.uuid().nullable(),
  retailerCount: z.number().int().nonnegative(),
});

const categoryMembershipSchema = z.object({ matchesCategory: z.boolean() });

/** Only the offer boundary crosses the DB transport. Search helpers stay in the
 * relation for filtering/ordering; baskets share the same validated offer data. */
export const genericOfferProjection = sql`listing, "sourceCategory", "retailerName", url, "imageUrl",
  "currentPriceCents", "regularPriceCents", "conditionalOffers", "observedAt", available,
  fingerprint, version, "canonicalId", "retailerCount"`;

export function genericProductOffer(raw: unknown, now = new Date(), mode: PriceMode = "standard") {
  const row = rowSchema.parse(raw);

  if (row.currentPriceCents <= 0) return null;

  if (row.version !== normalizationVersion || row.fingerprint !== catalogFingerprint(row.listing)) {
    return null;
  }

  const retailerId = retailerIdSchema.parse(row.listing.retailerId);
  const url = retailerProductUrl({ retailerId, url: row.url });

  if (!url || !row.listing.title.trim()) return null;

  const attributes = normalizeCatalogListing(row.listing);
  const family = classifyProductFamily({
    title: row.listing.title,
    retailerId,
    sourceCategory: row.sourceCategory,
  });
  const conditionalOffers = currentConditionalOffers(row.conditionalOffers, now);
  const ranking = rankedPrice(row.currentPriceCents, conditionalOffers, mode, now);
  const calculation = calculateUnitPrice(
    {
      ...attributes,
      title: row.listing.title,
      productFamily: family.family,
      currentPriceCents: ranking.priceCents,
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
    regularPriceCents: meaningfulReferencePrice(
      row.currentPriceCents,
      row.regularPriceCents ?? null,
    ),
    conditionalOffers,
    ranking,
    observedAt: row.observedAt,
    available: row.available,
    url,
    imageUrl: productImageUrl(row.imageUrl),
    canonicalId: row.canonicalId,
    retailerCount: row.retailerCount,
    unitPrice: calculation.price,
    unitPriceUnavailableReason: calculation.reason,
  };
}

export type GenericProductOffer = NonNullable<ReturnType<typeof genericProductOffer>>;

export async function searchGenericProductOffers(
  db: ReturnType<typeof createDatabase>,
  rawQuery: string,
  sort: GenericOfferSort = "relevance",
  now = new Date(),
  filters: SearchFilters = searchFilters({ sort }),
  unlimited = false,
  canonicalId: string | null = null,
): Promise<GenericProductOffer[]> {
  const { offers } = await readGenericProductOffers(db, rawQuery, now, filters, canonicalId);

  return unlimited ? offers : limitGenericOffers(offers, genericOfferSort(sort));
}

/** Read every candidate once. Optional category membership partitions the same
 * ordered snapshot for public results and unfiltered discovery coverage. */
async function readGenericProductOffers(
  db: ReturnType<typeof createDatabase>,
  rawQuery: string,
  now: Date,
  filters: SearchFilters,
  canonicalId: string | null = null,
  membershipCategory: SearchCategoryId | null = null,
): Promise<{ offers: GenericProductOffer[]; categoryOffers: GenericProductOffer[] | null }> {
  if (
    canonicalId
      ? !z.uuid().safeParse(canonicalId).success
      : !usefulSearchRequest(rawQuery, filters.category)
  ) {
    return { offers: [], categoryOffers: membershipCategory ? [] : null };
  }

  const query = normalizeSearchQuery(rawQuery);
  const interpretation = canonicalId ? null : resolveProductFamilyQuery(rawQuery);
  const requiredQuery = canonicalId ? "" : (interpretation?.remainingQuery ?? query);
  const predicates = [...new Set(requiredQuery.split(" ").filter(Boolean))].map(
    (token) =>
      sql`exists (select 1 from unnest(string_to_array(identity_text,' ')) word where ${/^\d+$/u.test(token) ? sql`word=${token}` : sql`starts_with(word,${token})`})`,
  );
  const tokens = [...new Set(requiredQuery.split(" ").filter(Boolean))];
  const textQuery = tokens
    .map((token) => `'${token}'${/^\d+$/u.test(token) ? "" : ":*"}`)
    .join(" & ");
  const familyPredicate = interpretation
    ? genericFamilyCandidatePredicate(interpretation.family)
    : sql`true`;
  const [result] = await db.batch([
    db.execute(sql`${eligibleProductIdentities}, generic as (
    ${currentGenericOfferRows(now, filters.category, "history", membershipCategory)}
  ) select ${genericOfferProjection}${membershipCategory ? sql`, "matchesCategory"` : sql``} from generic where ${canonicalId ? sql`"canonicalId"=${canonicalId}::uuid` : sql`true`} and ${predicates.length ? sql.join(predicates, sql` and `) : sql`true`}
    and ${textQuery ? sql`(search_identity='' or search_vector@@to_tsquery('simple',${textQuery}))` : sql`true`}
    and ${familyPredicate}
  order by (title_text=${query}) desc, starts_with(title_text,${query}) desc,
    public.similarity(title_text,${query}) desc, title_text collate "C", listing->>'id' limit ${catalogPolicy.overflowSentinel}`),
  ]);

  // Current catalog already has a bounded operational guard. Refuse truncation:
  // lowest-price modes must consider every admitted candidate before limiting.
  if (result.rows.length > catalogPolicy.retainedListingCap) {
    throw new Error("Generic search candidate bound exceeded");
  }

  const offers: GenericProductOffer[] = [];
  const categoryOffers: GenericProductOffer[] | null = membershipCategory ? [] : null;

  for (const row of result.rows) {
    const matchesCategory = membershipCategory
      ? categoryMembershipSchema.parse(row).matchesCategory
      : false;
    const offer = genericProductOffer(row, now, filters.priceMode);
    if (!offer) {
      continue;
    }

    offers.push(offer);
    if (matchesCategory) {
      categoryOffers?.push(offer);
    }
  }

  const select = (candidates: GenericProductOffer[]) =>
    filterGenericOffers(
      interpretation ? selectFamilyOffers(candidates, interpretation.family) : candidates,
      filters,
    );

  return { offers: select(offers), categoryOffers: categoryOffers && select(categoryOffers) };
}

async function publicSearchOfferScopes(
  db: ReturnType<typeof createDatabase>,
  query: string,
  now: Date,
  filters: SearchFilters,
) {
  const scopeFilters = searchFilters({
    sort: filters.sort,
    priceMode: filters.priceMode,
    category: filters.category,
  });
  if (filters.category && usefulSearchQuery(query)) {
    // Global candidates already contain the complete category subset. Membership
    // uses acquired source paths on the native UUID, never title/family guesses.
    // Apply the existing global overflow guard before partitioning or pagination.
    const { offers, categoryOffers } = await readGenericProductOffers(
      db,
      query,
      now,
      { ...scopeFilters, category: null },
      null,
      filters.category,
    );
    return { offers: categoryOffers ?? [], underlyingOffers: offers };
  }

  const { offers } = await readGenericProductOffers(db, query, now, scopeFilters);
  return { offers, underlyingOffers: null };
}

/** A conservative SQL superset; core classification/compatibility still decide. */
export function genericFamilyCandidatePredicate(
  family: ProductFamily,
  retailerId: SQL = sql`listing->>'retailerId'`,
): SQL {
  const evidence = familySearchEvidence(family);
  const predicates = [
    ...evidence.titleHints.map((hint) => sql`folded_title like ${`%${hint}%`}`),
    ...evidence.categories
      .filter((entry) => entry.ids.length)
      .map(
        (entry) =>
          sql`${retailerId}=${entry.retailer} and "sourceCategory" in (${sql.join(
            entry.ids.map((id) => sql`${id}`),
            sql`,`,
          )})`,
      ),
  ];
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export async function searchPublicProducts(
  db: ReturnType<typeof createDatabase>,
  query: string,
  sort: GenericOfferSort = "relevance",
  now = new Date(),
  filters: SearchFilters = searchFilters({ sort }),
  page = 1,
  options: { includeComparisons?: boolean } = {},
) {
  validateSearchPage(page);
  const [products, offerScopes, underlyingProducts] = await Promise.all([
    options.includeComparisons === false
      ? []
      : searchCanonicalProducts(db, query, now, page, filters.category),
    publicSearchCandidates(db, query, sort, now, filters),
    options.includeComparisons !== false && filters.category && usefulSearchQuery(query)
      ? searchCanonicalProducts(db, query, now, page)
      : null,
  ]);
  // Exact comparison identity/routes remain unchanged. In a recognized family
  // search, an incidental ingredient in an exact group is not useful coverage.
  const family = resolveProductFamilyQuery(query)?.family ?? null;
  const relevantProducts = productsInQueryFamily(products, family);
  return {
    ...offerScopes,
    products: relevantProducts
      .map((p) => publicProduct(p, now, filters.priceMode))
      .filter(
        (p) =>
          (!filters.retailer || p.offers.some((o) => o.retailerId === filters.retailer)) &&
          (!filters.unit || offerScopes.offers.some((o) => o.canonicalId === p.id)),
      ),
    offers: limitGenericOffers(offerScopes.offers, sort, page),
    page,
    hasMore: offerScopes.totalOffers > page * 30 || products.length === 20,
    usefulResultCount:
      productsInQueryFamily(underlyingProducts ?? products, family).length +
      offerScopes.usefulResultCount,
  };
}

async function publicSearchCandidates(
  db: ReturnType<typeof createDatabase>,
  query: string,
  sort: GenericOfferSort,
  now: Date,
  filters: SearchFilters,
) {
  const { offers, underlyingOffers } = await publicSearchOfferScopes(db, query, now, filters);
  const filteredOffers = filterGenericOffers(offers, filters);
  // Scope this presentation order to public lexical relevance. Shared basket
  // readers, exact comparisons and refresh/demand candidates keep their order.
  const orderedOffers =
    sort === "relevance" && !resolveProductFamilyQuery(query)
      ? prioritizeWholeWordSearchResults(filteredOffers, query)
      : filteredOffers;
  return {
    offers: orderedOffers,
    totalOffers: filteredOffers.length,
    discoveryRetailers: usefulSearchQuery(query)
      ? missingDiscoveryRetailers(
          Object.fromEntries(
            retailerIdSchema.options.map((retailer) => [
              retailer,
              (underlyingOffers ?? offers).filter((offer) => offer.retailerId === retailer).length,
            ]),
          ),
        )
      : [],
    refreshListingIds: offers.map((offer) => offer.id),
    availableUnits: [
      ...new Set(
        offers
          .filter((o) => !filters.retailer || o.retailerId === filters.retailer)
          .flatMap((o) =>
            o.unitPrice ? [o.unitPrice.displayUnit === "l" ? "L" : o.unitPrice.displayUnit] : [],
          ),
      ),
    ],
    usefulResultCount: (underlyingOffers ?? offers).length,
  };
}

function validateSearchPage(page: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > Math.ceil(catalogPolicy.retainedListingCap / 20)
  ) {
    throw new Error("Invalid search page");
  }
}

/** Public product cards: group the full admitted scope before sorting/pagination.
 * Identity and current purchase eligibility remain owned by the existing reader.
 * One aggregate SQL read, including category/global demand scopes; no card reads. */
export async function searchGroupedPublicProducts(
  db: ReturnType<typeof createDatabase>,
  query: string,
  sort: GenericOfferSort = "relevance",
  now = new Date(),
  filters: SearchFilters = searchFilters({ sort }),
  page = 1,
) {
  validateSearchPage(page);
  const { offers, ...scope } = await publicSearchCandidates(db, query, sort, now, filters);
  const products = groupSearchOffers(offers);
  return {
    ...scope,
    products: limitGenericOffers(products, sort, page),
    totalProducts: products.length,
    page,
    hasMore: products.length > page * 30,
  };
}

export type SearchProductResult = Awaited<
  ReturnType<typeof searchGroupedPublicProducts>
>["products"][number];

function productsInQueryFamily(products: ProductComparison[], family: ProductFamily | null) {
  if (!family) return products;

  return products.filter((product) =>
    product.offers.some((offer) => classifyProductFamily({ title: offer.title }).family === family),
  );
}

export function filterGenericOffers(
  offers: readonly GenericProductOffer[],
  filters: SearchFilters,
) {
  return offers.filter(
    (o) =>
      (!filters.retailer || o.retailerId === filters.retailer) &&
      (!filters.unit || o.unitPrice?.displayUnit === (filters.unit === "L" ? "l" : filters.unit)),
  );
}

/** Exact current offers use the same fingerprint/quantity/freshness boundary as
 * generic search and the existing public canonical eligibility CTE. */
export function getCanonicalCurrentProductOffers(
  db: ReturnType<typeof createDatabase>,
  id: string,
  now = new Date(),
  mode: PriceMode = "standard",
) {
  return searchGenericProductOffers(
    db,
    "",
    "relevance",
    now,
    searchFilters({ priceMode: mode }),
    true,
    id,
  );
}

/** Shared current normalized listing boundary, also used by basket snapshots.
 * Requires the narrow products CTE from eligibleProductIdentities. Basket
 * snapshots supply their shared current_prices relation as the price source. */
export function currentGenericOfferRows(
  now: Date,
  category: SearchCategoryId | null = null,
  priceSource: CurrentPriceSource = "history",
  membershipCategory: SearchCategoryId | null = null,
) {
  // Native basket keys stay outside the transport projection. They preserve
  // history join statistics and avoid rebuilding listing JSON in each family
  // category predicate or just to sort candidates by their textual UUID.
  return sql`    select ${priceSource === "snapshot" ? sql`l.id as listing_id,l.retailer_id as retailer_id,` : sql``}${membershipCategory ? sql`${categoryListingPredicate(sql`l.id`, membershipCategory)} as "matchesCategory",` : sql``} jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,
      'priceUnit',h.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,
      'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,
      l.category as "sourceCategory", r.name as "retailerName", l.url, l.image_url as "imageUrl", h.current_price_cents as "currentPriceCents", h.regular_price_cents as "regularPriceCents",
      ${listingOffers(sql`l.id`, sql`l.last_seen_at`)} as "conditionalOffers",
      l.last_seen_at as "observedAt", l.available, n.input_fingerprint as fingerprint, n.normalization_version as version,
      p.id as "canonicalId", coalesce(p."retailerCount",0) as "retailerCount",
      ${searchText(sql`n.normalized_title`)} as title_text,
      ${searchText(sql`n.normalized_title || ' ' || coalesce(n.brand,'')`)} as identity_text
      ,n.search_identity,to_tsvector('simple',n.search_identity) as search_vector,
      regexp_replace(lower(normalize(n.normalized_title,NFD)), '[^[:alnum:]]+', '', 'g') as folded_title
    from retailer_listings l join retailers r on r.id=l.retailer_id
    join listing_normalizations n on n.listing_id=l.id
    ${currentPriceJoin(priceSource)}
    left join canonical_product_listings a on a.listing_id=l.id
    left join products p on p.id=a.canonical_product_id
    where l.active and l.available is distinct from false and h.currency='PEN' and h.current_price_cents>0
      and h.price_unit=l.price_unit and h.price_unit in ('UN','KG')
      and l.last_seen_at between ${new Date(now.getTime() - listingRefreshPolicy.freshHours * 60 * 60 * 1000).toISOString()}::timestamptz and ${now.toISOString()}::timestamptz
      -- Filter the indexed UUID before JSON projection. Filtering listing->>'id'
      -- hides column statistics and can rescan all exact groups for every listing.
      and ${categoryListingPredicate(sql`l.id`, category)}
`;
}
