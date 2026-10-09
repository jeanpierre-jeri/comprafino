import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { persistListings } from "./ingestion.ts";
import { normalizeCatalog } from "./catalog.ts";
import { matchCatalog } from "./matching.ts";
import { getCanonicalProductComparison, searchCanonicalProducts } from "./public-products.ts";
import { knownListings } from "./listing-refresh.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("Makro migration and identity safety in an owned schema", () => {
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const observedAt = new Date("2026-10-08T12:00:00Z");
  const now = new Date("2026-10-08T12:30:00Z");
  const listing = (retailer: "makro" | "plaza-vea"): NormalizedRetailerListing => ({
    retailer,
    externalId: "11390020",
    productId: "101021448",
    title: "Leche Light GLORIA Lata 390g Paquete 6un",
    sourceBrand: "GLORIA",
    packageText: "Paquete 6un",
    sourceUnitMultiplier: 1,
    url: `https://${retailer === "makro" ? "www.makro.plazavea.com.pe" : "www.plazavea.com.pe"}/leche/p`,
    currentPriceCents: retailer === "makro" ? 2330 : 2400,
    currency: "PEN",
    priceUnit: "UN",
    available: true,
    observedAt,
  });

  beforeAll(() => harness.setup(), 30_000);
  beforeEach(() => harness.reset(), 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("seeds Makro, preserves same-SKU provenance and idempotent ordinary history", async () => {
    expect(await harness.scoped.query("select name from retailers where id='makro'")).toEqual([
      { name: "Makro" },
    ]);
    await persistListings(harness.db, "makro", [listing("makro")]);
    await persistListings(harness.db, "plaza-vea", [listing("plaza-vea")]);
    expect(await persistListings(harness.db, "makro", [listing("makro")])).toMatchObject({
      persisted: 0,
      changed: 0,
    });
    const identities = z
      .array(z.object({ retailer_id: z.string(), current_price_cents: z.number() }))
      .parse(
        await harness.scoped.query(
          "select retailer_id,current_price_cents from retailer_listings order by retailer_id",
        ),
      );
    expect(identities).toEqual([
      { retailer_id: "makro", current_price_cents: 2330 },
      { retailer_id: "plaza-vea", current_price_cents: 2400 },
    ]);
    expect(await harness.scoped.query("select count(*)::int as states from price_history")).toEqual(
      [{ states: 2 }],
    );
    expect((await knownListings(harness.db)).map((row) => row.retailer).sort()).toEqual([
      "makro",
      "plaza-vea",
    ]);
  });

  it("compares only matching packs and revokes exact identity immediately after a pack change", async () => {
    await persistListings(harness.db, "makro", [listing("makro")]);
    await persistListings(harness.db, "plaza-vea", [listing("plaza-vea")]);
    await normalizeCatalog(harness.db, 2000);
    await matchCatalog(harness.db, 2000);
    const products = await searchCanonicalProducts(harness.db, "leche gloria", now);
    expect(products).toHaveLength(1);
    const productId = products[0]!.id;
    expect(await getCanonicalProductComparison(harness.db, productId, now)).toMatchObject({
      retailerCount: 2,
      cheapestRetailers: ["Makro"],
    });
    const changed = {
      ...listing("makro"),
      title: "Leche Light GLORIA Lata 390g Paquete 3un",
      packageText: "Paquete 3un",
      observedAt: new Date("2026-10-08T12:10:00Z"),
    };
    await persistListings(harness.db, "makro", [changed]);
    expect(await getCanonicalProductComparison(harness.db, productId, now)).toBeNull();
    await normalizeCatalog(harness.db, 2000);
    await matchCatalog(harness.db, 2000);
    expect(await searchCanonicalProducts(harness.db, "leche gloria", now)).toEqual([]);
    // Identity change does not invent a price change.
    expect(await harness.scoped.query("select count(*)::int as states from price_history")).toEqual(
      [{ states: 2 }],
    );
  });
});
