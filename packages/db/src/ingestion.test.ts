import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { persistenceStatements } from "./ingestion.ts";
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
it("builds one transactional lock/upsert/close/open batch with parameterized source data", () => {
  const queries = persistenceStatements("tottus", [listing]).map((statement) =>
    new PgDialect().sqlToQuery(statement),
  );
  expect(queries).toHaveLength(4);
  expect(queries[0]?.sql).toContain("for update");
  expect(queries[1]?.sql).toContain("on conflict (retailer_id, external_id) do update");
  expect(queries[1]?.sql).toContain("retailer_listings.last_seen_at < excluded.last_seen_at");
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
