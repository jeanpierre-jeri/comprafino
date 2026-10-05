import { vtexCategories } from "./staple-categories.ts";
import type { VtexCategory } from "./staple-categories.ts";
import { lookupVtex } from "./targeted.ts";
import { z } from "zod";
import { listingSchema, normalizeWhitespace, parsePenCents } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import type { SearchRetailerAdapter } from "./adapter.ts";
import { assertRetailerSearch, fetchVtexSearch } from "./search.ts";

const sourcePage = z.array(
  z.object({
    brand: z.string().trim().min(1).optional(),
    productId: z.string().regex(/^\d+$/u),
    productName: z.string().trim().min(1),
    link: z.string().min(1),
    categoryId: z.string().optional(),
    "Presentación unitarios vitrina": z.array(z.string()).optional(),
    items: z.array(
      z.object({
        itemId: z.string().regex(/^\d+$/u),
        name: z.string().trim().min(1),
        measurementUnit: z.enum(["kg", "un"]),
        unitMultiplier: z.number().positive().finite(),
        images: z.array(z.object({ imageUrl: z.url() })).optional(),
        sellers: z.array(
          z.object({
            sellerId: z.string(),
            commertialOffer: z.object({
              Price: z.number().nonnegative().finite(),
              ListPrice: z.number().nonnegative().finite().optional(),
              IsAvailable: z.boolean(),
              AvailableQuantity: z.number().int().nonnegative(),
              Tax: z.literal(0),
            }),
          }),
        ),
      }),
    ),
  }),
);

/** Public seller-1 prices only; never calculate card/quantity teaser discounts. */
export function parsePlazaVeaPage(raw: unknown, observedAt: Date) {
  const products = sourcePage.parse(raw);
  const listings: NormalizedRetailerListing[] = [];
  for (const product of products) {
    const url = new URL(product.link, "https://www.plazavea.com.pe");
    if (url.origin !== "https://www.plazavea.com.pe" || !/^\/[^/]+\/p$/u.test(url.pathname))
      throw new Error("Unexpected Plaza Vea product URL");
    url.search = "";
    url.hash = "";
    for (const item of product.items) {
      const sellers = item.sellers.filter((seller) => seller.sellerId === "1");
      if (sellers.length > 1) throw new Error("Ambiguous Plaza Vea seller offer");
      const offer = sellers[0]?.commertialOffer;
      // Unavailable offers often have zero placeholders, not an obtainable price.
      if (!offer || !offer.IsAvailable || offer.AvailableQuantity === 0) continue;
      const currentPriceCents = parsePenCents(offer.Price);
      if (currentPriceCents === 0) throw new Error("Unexpected Plaza Vea available zero price");
      const listPriceCents =
        offer.ListPrice === undefined ? undefined : parsePenCents(offer.ListPrice);
      const regularPriceCents =
        listPriceCents !== undefined && listPriceCents > currentPriceCents
          ? listPriceCents
          : undefined;
      if (item.measurementUnit === "un" && item.unitMultiplier !== 1)
        throw new Error("Unexpected Plaza Vea unit multiplier; review price basis");
      const packageParts = (product["Presentación unitarios vitrina"] ?? [])
        .map(normalizeWhitespace)
        .filter(Boolean);
      if (item.measurementUnit === "kg")
        packageParts.push(`unitMultiplier: ${item.unitMultiplier} kg`);
      listings.push(
        listingSchema.parse({
          retailer: "plaza-vea",
          externalId: item.itemId,
          productId: product.productId,
          title: normalizeWhitespace(item.name),
          url: url.href,
          imageUrl: item.images?.[0]?.imageUrl,
          currentPriceCents,
          regularPriceCents,
          currency: "PEN",
          priceUnit: item.measurementUnit === "kg" ? "KG" : "UN",
          available: true,
          packageText: packageParts.join("; ") || undefined,
          sourceBrand: product.brand,
          sourceUnitMultiplier: item.unitMultiplier,
          category: product.categoryId || undefined,
          observedAt,
        }),
      );
    }
  }
  return { listings, discovered: products.length };
}

export const plazaVeaCatalogUrl =
  "https://www.plazavea.com.pe/api/catalog_system/pub/products/search";

export function createPlazaVeaAdapter(
  fetchPage: typeof fetch = fetch,
  category: VtexCategory = "dairy",
): SearchRetailerAdapter {
  if (category === "eggs" || !Object.hasOwn(vtexCategories["plaza-vea"], category))
    throw new Error("Unsupported PlazaVea category");
  return {
    retailer: "plaza-vea",
    lookupListing: (known) => lookupVtex(fetchPage, plazaVeaCatalogUrl, known, parsePlazaVeaPage),
    async searchProducts(query, limit) {
      assertRetailerSearch(query, limit);
      const url = new URL(plazaVeaCatalogUrl);
      url.searchParams.set("ft", query);
      url.searchParams.set("sc", "1");
      url.searchParams.set("_from", "0");
      url.searchParams.set("_to", "19");
      // VTEX expects URI-encoded whitespace, rather than form-style plus separators.
      url.search = url.search.replaceAll("+", "%20");
      return fetchVtexSearch(fetchPage, url, parsePlazaVeaPage, limit);
    },
    async fetchListings(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Limit must be an integer from 1 to 500");
      if (category !== "dairy" && limit > 20)
        throw new Error("Limit must be at most 20 for staple categories");
      const maxPages = category === "dairy" ? 25 : 2;
      const listings = new Map<string, NormalizedRetailerListing>();
      let discovered = 0;
      // Bound source coverage too: at most 500 products / 25 sequential pages.
      for (let from = 0, page = 0; from < 500 && page < maxPages && listings.size < limit; page++) {
        if (page > 0) await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        const to = Math.min(from + 19, 499);
        const url = new URL(plazaVeaCatalogUrl);
        url.searchParams.set("fq", `C:/${vtexCategories["plaza-vea"][category]}/`);
        url.searchParams.set("sc", "1");
        url.searchParams.set("_from", String(from));
        url.searchParams.set("_to", String(to));
        const response = await fetchPage(url, {
          headers: {
            "User-Agent": "CompraFino/0.1 (bounded public catalog ingestion)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });
        if (!response.ok)
          throw new Error(`Plaza Vea HTTP ${response.status}; ingestion stopped without retries`);
        const range = /^(\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("resources") ?? "");
        if (!range) throw new Error("Plaza Vea pagination range missing or invalid");
        const start = Number(range[1]);
        const end = Number(range[2]);
        const total = Number(range[3]);
        if (
          ![start, end, total].every(Number.isSafeInteger) ||
          start !== from ||
          end < start ||
          end > to ||
          total <= start ||
          (total <= end && end !== to)
        )
          throw new Error("Plaza Vea pagination did not advance or returned an invalid range");
        const raw: unknown = await response.json();
        const parsed = parsePlazaVeaPage(raw, new Date());
        if (parsed.discovered !== Math.min(end + 1, total) - start)
          throw new Error("Plaza Vea pagination range does not match product count");
        discovered += parsed.discovered;
        for (const listing of parsed.listings) {
          if (!listings.has(listing.externalId) && listings.size < limit)
            listings.set(listing.externalId, listing);
        }
        if (end + 1 >= total) break;
        from = end + 1;
      }
      if (!listings.size) throw new Error("Plaza Vea returned no useful listings");
      return { listings: [...listings.values()], discovered };
    },
  };
}
