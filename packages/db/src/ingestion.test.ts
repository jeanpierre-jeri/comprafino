import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { persistenceStatements } from "./ingestion.ts";
import { catalogPolicy, listingRefreshPolicy, matchingThresholds } from "@comprafino/core";
import { currentGenericOfferRows } from "./generic-offers.ts";
import { eligibleProducts } from "./public-products.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";
const listing: NormalizedRetailerListing = {
  retailer: "tottus",
  externalId: "1",
  productId: "2",
  title: "Quote ' test",
  url: "https://www.tottus.com.pe/tottus-pe/articulo/2/sample",
  currentPriceCents: 1290,
  currency: "PEN",
  priceUnit: "UN",
  observedAt: new Date("2026-10-03T09:00:00Z"),
};
it("uses shared policy in SQL admission, confidence and current observation bounds", () => {
  const dialect = new PgDialect();
  const admission = persistenceStatements("tottus", [listing]).map((query) =>
    dialect.sqlToQuery(query),
  );
  expect(admission.some((query) => query.params.includes(catalogPolicy.retainedListingCap))).toBe(
    true,
  );
  const exact = dialect.sqlToQuery(eligibleProducts);
  expect(exact.params.filter((value) => value === matchingThresholds.auto)).toHaveLength(2);
  const now = new Date("2026-10-05T12:00:00Z");
  const generic = dialect.sqlToQuery(currentGenericOfferRows(now));
  expect(generic.params).toContain(
    new Date(now.getTime() - listingRefreshPolicy.freshHours * 3_600_000).toISOString(),
  );
});
it("builds one transactional lock/upsert/close/open batch with parameterized source data", () => {
  const queries = persistenceStatements("tottus", [listing]).map((statement) =>
    new PgDialect().sqlToQuery(statement),
  );
  expect(queries).toHaveLength(4);
  expect(queries[0]?.sql).toContain("for update");
  expect(queries[1]?.sql).toContain("on conflict (retailer_id, external_id) do update");
  expect(queries[1]?.sql).toContain("retailer_listings.last_seen_at < excluded.last_seen_at");
  expect(queries[1]?.sql).toContain("insert into listing_observation_days");
  expect(queries[1]?.sql).toContain("on conflict (listing_id, observation_date)");
  expect(queries[1]?.sql).toContain("America/Lima");
  expect(queries[1]?.sql).toContain(
    "x.current_price_cents > 0 and u.available is distinct from false",
  );
  expect(queries[1]?.sql).not.toContain(listing.title);
  expect(
    queries[1]?.params.some((value) => typeof value === "string" && value.includes(listing.title)),
  ).toBe(true);
  expect(queries[2]?.sql).toContain("is distinct from");
  expect(queries[2]?.sql).toContain("valid_until = l.last_seen_at");
  expect(queries[3]?.sql).toContain("not exists");
  expect(queries[3]?.sql).toContain("h.valid_until is null");
});
it("rejects duplicate identity, mixed retailers and invalid money before SQL", () => {
  expect(() => persistenceStatements("tottus", [listing, listing])).toThrow(
    "Duplicate listing identities",
  );
  expect(() => persistenceStatements("metro", [listing])).toThrow("Mixed retailers");
  expect(() => persistenceStatements("tottus", [{ ...listing, currentPriceCents: 12.9 }])).toThrow(
    /expected int/u,
  );
});

it("rejects zero ordinary payable prices before persistence", () => {
  expect(() => persistenceStatements("tottus", [{ ...listing, currentPriceCents: 0 }])).toThrow(
    "Ordinary payable price must be positive",
  );
});
