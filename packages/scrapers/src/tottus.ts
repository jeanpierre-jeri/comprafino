import { assertPublicAccess } from "./public-access.ts";
import { assertTottusPageBounds, parseTottusPage } from "./tottus-parser.ts";
import { publicResponse } from "./catalog-sources.ts";
import { parseTottusCatalogProduct } from "./targeted.ts";

export { parseTottusPage } from "./tottus-parser.ts";

import { lookupTottus } from "./targeted.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";
import type { SearchRetailerAdapter } from "./adapter.ts";
import { assertRetailerSearch, boundedSearchListings } from "./search.ts";

export const tottusCategoryUrl = "https://www.tottus.com.pe/tottus-pe/lista/CATG16076/Carnes";

export const tottusCategoryUrls = {
  meat: tottusCategoryUrl,
  dairy: "https://www.tottus.com.pe/tottus-pe/lista/CATG16061/Lacteos",
} as const;

export function createTottusAdapter(
  fetchPage: typeof fetch = fetch,
  category: keyof typeof tottusCategoryUrls = "meat",
): SearchRetailerAdapter {
  if (category !== "meat" && category !== "dairy") {
    throw new Error("Unsupported Tottus category");
  }

  return {
    retailer: "tottus",
    lookupListing: (known) => lookupTottus(fetchPage, known),
    async searchProducts(query, limit) {
      assertRetailerSearch(query, limit);
      const url = new URL("https://www.tottus.com.pe/tottus-pe/buscar");
      url.searchParams.set("Ntt", query);
      url.searchParams.set("page", "1");
      const { response, productUrl } = await publicResponse(url, fetchPage, true);
      if (productUrl) {
        const parsed = parseTottusCatalogProduct(await response.text(), productUrl, new Date());
        return {
          listings: boundedSearchListings(parsed.listings, limit, query),
          discovered: parsed.discovered,
        };
      }

      const parsed = parseTottusPage(await response.text(), new Date());

      assertTottusPageBounds(parsed, 1);

      return {
        listings: boundedSearchListings(parsed.listings, limit, query),
        discovered: parsed.discovered,
      };
    },
    async fetchListings(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("Limit must be an integer from 1 to 500");
      }

      const listings = new Map<string, NormalizedRetailerListing>();
      let discovered = 0;

      // Sequential requests, a one-second pause, no retries or unbounded crawling.
      for (let page = 1; page <= 12 && listings.size < limit; page++) {
        if (page > 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        }

        const url = new URL(tottusCategoryUrls[category]);
        url.searchParams.set("page", String(page));
        const response = await fetchPage(url, {
          headers: {
            "User-Agent": "CompraFino/0.1 (bounded public catalog ingestion)",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });

        assertPublicAccess(response);

        if (!response.ok) {
          throw new Error(`Tottus HTTP ${response.status}; ingestion stopped without retries`);
        }

        const parsed = parseTottusPage(await response.text(), new Date());

        if (parsed.pagination.currentPage !== page) {
          throw new Error("Tottus pagination did not advance");
        }

        discovered += parsed.discovered;

        for (const listing of parsed.listings) {
          if (!listings.has(listing.externalId) && listings.size < limit) {
            listings.set(listing.externalId, listing);
          }
        }

        if (
          page * parsed.pagination.perPage >= parsed.pagination.count ||
          parsed.listings.length === 0
        ) {
          break;
        }
      }

      if (!listings.size) {
        throw new Error("Tottus returned no useful listings");
      }

      return { listings: [...listings.values()], discovered };
    },
  };
}
