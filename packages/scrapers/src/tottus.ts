import { z } from "zod";
import { listingSchema, normalizeWhitespace, parsePenCents } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";

import type { RetailerAdapter } from "./adapter.ts";
const sourceProduct = z.object({
  brand: z.string().trim().min(1).optional(),
  productId: z.string().regex(/^\d+$/u),
  skuId: z.string().regex(/^\d+$/u),
  displayName: z.string().min(1),
  url: z.url(),
  sellerId: z.literal("TOTTUS_PERU"),
  mediaUrls: z.array(z.url()).optional(),
  measurements: z.object({ format: z.string().optional(), unit: z.enum(["KG", "UN"]) }),
  merchantCategoryId: z.string().optional(),
  prices: z.array(
    z.object({
      type: z.string(),
      symbol: z.string(),
      crossed: z.boolean(),
      price: z.array(z.union([z.string(), z.number()])).length(1),
    }),
  ),
});
const sourcePage = z.object({
  props: z.object({
    pageProps: z.object({
      results: z.array(sourceProduct),
      pagination: z.object({
        count: z.number().int().nonnegative(),
        perPage: z.number().int().positive(),
        currentPage: z.number().int().positive(),
      }),
    }),
  }),
});

/** Read only the site's explicit hydration JSON; no general HTML parser required. */
export function parseTottusPage(html: string, observedAt: Date) {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/u.exec(html);
  if (!script)
    throw new Error("Tottus public listing JSON is missing; stop and inspect the source");
  const raw: unknown = JSON.parse(script[1]!);
  const page = sourcePage.parse(raw).props.pageProps;
  const listings = page.results.map((product) => {
    const current = product.prices.filter(
      (price) => price.type === "internetPrice" && !price.crossed,
    );
    const regular = product.prices.filter((price) => price.type === "normalPrice");
    if (current.length !== 1 || regular.length > 1)
      throw new Error("Ambiguous or missing Tottus internet/regular price");
    for (const price of [...current, ...regular]) {
      if (price.symbol.trim() !== "S/") throw new Error("Unexpected Tottus currency");
    }
    const url = new URL(product.url);
    if (
      url.origin !== "https://www.tottus.com.pe" ||
      !url.pathname.startsWith(`/tottus-pe/articulo/${product.productId}/`)
    ) {
      throw new Error("Unexpected Tottus product URL");
    }
    url.search = "";
    url.hash = "";
    const currentPriceCents = parsePenCents(current[0]!.price[0]!);
    const normalPriceCents = regular[0] ? parsePenCents(regular[0].price[0]!) : undefined;
    return listingSchema.parse({
      retailer: "tottus",
      externalId: product.skuId,
      productId: product.productId,
      title: normalizeWhitespace(product.displayName),
      url: url.href,
      imageUrl: product.mediaUrls?.[0],
      currentPriceCents,
      regularPriceCents:
        normalPriceCents !== undefined && normalPriceCents > currentPriceCents
          ? normalPriceCents
          : undefined,
      currency: "PEN",
      priceUnit: product.measurements.unit,
      packageText: product.measurements.format
        ? normalizeWhitespace(product.measurements.format) || undefined
        : undefined,
      sourceBrand: product.brand,
      category: product.merchantCategoryId || undefined,
      observedAt,
    });
  });
  return { listings, pagination: page.pagination };
}
export const tottusCategoryUrl = "https://www.tottus.com.pe/tottus-pe/lista/CATG16076/Carnes";
export function createTottusAdapter(fetchPage: typeof fetch = fetch): RetailerAdapter {
  return {
    retailer: "tottus",
    async fetchListings(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Limit must be an integer from 1 to 500");
      const listings = new Map<string, NormalizedRetailerListing>();
      let discovered = 0;
      // Sequential requests, a one-second pause, no retries or unbounded crawling.
      for (let page = 1; page <= 12 && listings.size < limit; page++) {
        if (page > 1) await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        const url = new URL(tottusCategoryUrl);
        url.searchParams.set("page", String(page));
        const response = await fetchPage(url, {
          headers: {
            "User-Agent": "CompraFino/0.1 (bounded public catalog ingestion)",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });
        if (!response.ok)
          throw new Error(`Tottus HTTP ${response.status}; ingestion stopped without retries`);
        const parsed = parseTottusPage(await response.text(), new Date());
        if (parsed.pagination.currentPage !== page)
          throw new Error("Tottus pagination did not advance");
        discovered += parsed.listings.length;
        for (const listing of parsed.listings) {
          if (!listings.has(listing.externalId) && listings.size < limit)
            listings.set(listing.externalId, listing);
        }
        if (
          page * parsed.pagination.perPage >= parsed.pagination.count ||
          parsed.listings.length === 0
        )
          break;
      }
      if (!listings.size) throw new Error("Tottus returned no useful listings");
      return { listings: [...listings.values()], discovered };
    },
  };
}
