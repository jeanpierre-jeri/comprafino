import { z } from "zod";
import { listingSchema, normalizeWhitespace, parsePenCents } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import type { RetailerAdapter } from "./adapter.ts";

const sourcePage = z.array(
  z.object({
    brand: z.string().trim().min(1).optional(),
    productId: z.string().regex(/^\d+$/u),
    productName: z.string().trim().min(1),
    link: z.string().min(1),
    categoryId: z.string().optional(),
    Envase: z.array(z.string()).optional(),
    Formato: z.array(z.string()).optional(),
    Tamaño: z.array(z.string()).optional(),
    "Pack-Unitario": z.array(z.string()).optional(),
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
export function parseMetroPage(raw: unknown, observedAt: Date) {
  const products = sourcePage.parse(raw);
  const listings: NormalizedRetailerListing[] = [];
  for (const product of products) {
    const url = new URL(product.link, "https://www.metro.pe");
    if (url.origin !== "https://www.metro.pe" || !/^\/[^/]+\/p$/u.test(url.pathname))
      throw new Error("Unexpected Metro product URL");
    url.search = "";
    url.hash = "";
    for (const item of product.items) {
      const sellers = item.sellers.filter((seller) => seller.sellerId === "1");
      if (sellers.length > 1) throw new Error("Ambiguous Metro seller offer");
      const offer = sellers[0]?.commertialOffer;
      // Unavailable offers often have zero placeholders, not an obtainable price.
      if (!offer || !offer.IsAvailable || offer.AvailableQuantity === 0) continue;
      const currentPriceCents = parsePenCents(offer.Price);
      if (currentPriceCents === 0) throw new Error("Unexpected Metro available zero price");
      const listPriceCents =
        offer.ListPrice === undefined ? undefined : parsePenCents(offer.ListPrice);
      const regularPriceCents =
        listPriceCents !== undefined && listPriceCents > currentPriceCents
          ? listPriceCents
          : undefined;
      if (item.measurementUnit === "un" && item.unitMultiplier !== 1)
        throw new Error("Unexpected Metro unit multiplier; review price basis");
      // Preserve labelled source text, excluding literal specification placeholders.
      // Titles retain pack sizes; do not derive quantities from title/description.
      const packageParts = (["Envase", "Formato", "Tamaño", "Pack-Unitario"] as const).flatMap(
        (key) =>
          (product[key] ?? [])
            .map(normalizeWhitespace)
            .filter((value) => value && value !== key)
            .map((value) => `${key}: ${value}`),
      );
      if (item.measurementUnit === "kg")
        packageParts.push(`unitMultiplier: ${item.unitMultiplier} kg`);
      listings.push(
        listingSchema.parse({
          retailer: "metro",
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

export const metroCatalogUrl = "https://www.metro.pe/api/catalog_system/pub/products/search";

export function createMetroAdapter(fetchPage: typeof fetch = fetch): RetailerAdapter {
  return {
    retailer: "metro",
    async fetchListings(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Limit must be an integer from 1 to 500");
      const listings = new Map<string, NormalizedRetailerListing>();
      let discovered = 0;
      // Bound source coverage too: at most 500 products / 25 sequential pages.
      for (let from = 0, page = 0; from < 500 && page < 25 && listings.size < limit; page++) {
        if (page > 0) await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        const to = Math.min(from + 19, 499);
        const url = new URL(metroCatalogUrl);
        url.searchParams.set("fq", "C:/1001436/");
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
          throw new Error(`Metro HTTP ${response.status}; ingestion stopped without retries`);
        const range = /^(\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("resources") ?? "");
        if (!range) throw new Error("Metro pagination range missing or invalid");
        const start = Number(range[1]);
        const end = Number(range[2]);
        const total = Number(range[3]);
        if (
          ![start, end, total].every(Number.isSafeInteger) ||
          start !== from ||
          end < start ||
          end > to ||
          total <= end
        )
          throw new Error("Metro pagination did not advance or returned an invalid range");
        const raw: unknown = await response.json();
        const parsed = parseMetroPage(raw, new Date());
        if (parsed.discovered !== end - start + 1)
          throw new Error("Metro pagination range does not match product count");
        discovered += parsed.discovered;
        for (const listing of parsed.listings) {
          if (!listings.has(listing.externalId) && listings.size < limit)
            listings.set(listing.externalId, listing);
        }
        if (end + 1 >= total) break;
        from = end + 1;
      }
      if (!listings.size) throw new Error("Metro returned no useful listings");
      return { listings: [...listings.values()], discovered };
    },
  };
}
