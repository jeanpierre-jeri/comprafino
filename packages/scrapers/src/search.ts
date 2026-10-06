import { discoveryRetailerLimit, validDiscoveryQuery } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";

export function assertRetailerSearch(query: string, limit: number) {
  if (!validDiscoveryQuery(query)) {
    throw new Error("Invalid discovery query");
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > discoveryRetailerLimit) {
    throw new Error("Retailer search limit must be 1..10");
  }
}

export function boundedSearchListings(
  listings: readonly NormalizedRetailerListing[],
  limit: number,
) {
  return [...new Map(listings.map((row) => [row.externalId, row])).values()].slice(0, limit);
}

/** One VTEX page, no retries; empty arrays are successful searches. */
export async function fetchVtexSearch(
  fetchPage: typeof fetch,
  url: URL,
  parse: (raw: unknown, at: Date) => { listings: NormalizedRetailerListing[]; discovered: number },
  limit: number,
) {
  const response = await fetchPage(url, {
    headers: {
      "User-Agent": "CompraFino/0.1 (bounded public catalog discovery)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error("Retailer search request failed");
  }

  const raw: unknown = await response.json();

  if (!Array.isArray(raw) || raw.length > 20) {
    throw new Error("Unexpected search page size");
  }

  const range = /^(\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("resources") ?? "");

  if (!range || Number(range[1]) !== 0 || Number(range[2]) > 19) {
    throw new Error("Unexpected search range");
  }

  const total = Number(range[3]);
  const end = Number(range[2]);

  if (
    !Number.isSafeInteger(total) ||
    raw.length !== Math.min(total, 20) ||
    (end !== 19 && end !== raw.length - 1)
  ) {
    throw new Error("Search range does not match payload");
  }

  const parsed = parse(raw, new Date());

  return { listings: boundedSearchListings(parsed.listings, limit), discovered: parsed.discovered };
}
