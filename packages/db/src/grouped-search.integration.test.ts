import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchFilters } from "@comprafino/core";
import { searchGroupedPublicProducts } from "./generic-offers.ts";
import { evaluatePairs, persistMatching } from "./matching.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import { catalogTestContext, observation, publicNow } from "./testing/catalog-fixtures.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { catalogBenchmarkObserver } from "./testing/catalog-benchmark-observer.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("grouped search (owned PostgreSQL schema)", () => {
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, seedPublicProduct, seedGeneric, catalogRows } = harness;
  beforeAll(() => harness.setup(), 30_000);
  beforeEach(() => harness.reset(), 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  const read = (params = {}, page = 1) => {
    const filters = searchFilters(params);
    return searchGroupedPublicProducts(db, "gloria", filters.sort, publicNow, filters, page);
  };

  it("collapses confirmed duplicates but preserves identical unlinked SKUs and different presentations", async () => {
    const milk = await seedPublicProduct("light", "Leche Gloria Light Lata 390g");
    await seedPublicProduct("large", "Leche Gloria Light Lata 400g");
    const first = await seedGeneric("Leche Gloria Light Lata 390g", 500);
    const second = await seedGeneric("Leche Gloria Light Lata 390g", 550);
    const result = await read();
    expect(result.totalProducts).toBe(4);
    expect(result.totalOffers).toBe(6);
    expect(result.products.find((product) => product.id === milk.id)?.offers).toHaveLength(2);
    expect(
      result.products
        .filter((product) => !product.canonicalId)
        .map((product) => product.id)
        .sort(),
    ).toEqual([first.id, second.id].sort());
  });

  it("uses only filtered offers for minima and coverage and reads once for category plus text", async () => {
    const milk = await seedPublicProduct("filtered", "Leche Gloria Light Lata 390g");
    const metro = milk.rows.find((row) => row.retailer === "metro")!;
    await query("update price_history set current_price_cents=500 where listing_id=$1", [metro.id]);
    expect((await read()).products[0]).toMatchObject({
      retailerCount: 2,
      ordinaryOffer: { currentPriceCents: 500 },
    });
    const plaza = await read({ retailer: "plaza-vea", unit: "kg" });
    expect(plaza).toMatchObject({ totalProducts: 1, totalOffers: 1, hasMore: false });
    expect(plaza.products[0]).toMatchObject({
      id: milk.id,
      retailerCount: 1,
      ordinaryOffer: { currentPriceCents: 1290 },
    });
    const empty = await read({ unit: "L" });
    expect(empty).toMatchObject({ totalProducts: 0, totalOffers: 0 });
    expect(empty.usefulResultCount).toBe(2);
    await query(
      "insert into catalog_sources(retailer_id,source_key,name,url) values('plaza-vea','dairy','Lácteos y Huevos / Leches','https://www.plazavea.com.pe/leches')",
    );
    await query(
      "insert into catalog_source_listings(source_id,listing_id) select s.id,l.id from catalog_sources s join retailer_listings l on l.retailer_id=s.retailer_id",
    );
    const observer = catalogBenchmarkObserver(harness);
    const measured = await observer.observe(
      () =>
        searchGroupedPublicProducts(
          observer.db,
          "gloria",
          "relevance",
          publicNow,
          searchFilters({ category: "lacteos-huevos" }),
        ),
      true,
    );
    expect(measured.result.products[0]).toMatchObject({
      id: milk.id,
      retailerCount: 1,
      ordinaryOffer: { currentPriceCents: 1290 },
    });
    expect(measured.metrics.statements).toHaveLength(1);
    expect(measured.result.totalOffers).toBe(1);
    expect(measured.result.usefulResultCount).toBe(2);
  });

  it("counts and sorts complete groups before pagination with deterministic price ties", async () => {
    for (let index = 0; index < 31; index++) {
      await seedPublicProduct(`page-${index}`, `Leche Gloria Light Tipo ${index} Lata 390g`);
    }
    for (const sort of ["relevance", "total-price", "unit-price"] as const) {
      const first = await read({ sort });
      const second = await read({ sort }, 2);
      expect(first).toMatchObject({ totalProducts: 31, totalOffers: 62, hasMore: true });
      expect(first.products).toHaveLength(30);
      expect(second.products).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      const all = [...first.products, ...second.products];
      expect(new Set(all.map((product) => product.id)).size).toBe(31);
      expect(
        all.every((product) => product.retailerCount === 2 && product.cheapestOffers.length === 2),
      ).toBe(true);
      expect((await read({ sort })).products.map((product) => product.id)).toEqual(
        first.products.map((product) => product.id),
      );
      expect((await read({ sort }, 3)).products).toEqual([]);
    }
  }, 60_000);

  it.each([
    "false",
    "stale",
    "future",
    "zero",
    "inactive",
    "fingerprint",
    "version",

    "price-unit",
  ])("excludes %s offers from product price and store coverage", async (failure) => {
    const milk = await seedPublicProduct("eligibility", "Leche Gloria Light Lata 390g");
    const metro = milk.rows.find((row) => row.retailer === "metro")!;
    await query("update price_history set current_price_cents=100 where listing_id=$1", [metro.id]);
    const updates: Record<string, string> = {
      false: "update retailer_listings set available=false where id=$1",
      stale:
        "update retailer_listings set first_seen_at=first_seen_at-interval '48 hours', last_seen_at=last_seen_at-interval '48 hours' where id=$1",
      future:
        "update retailer_listings set last_seen_at=last_seen_at+interval '48 hours' where id=$1",
      zero: "update price_history set current_price_cents=0 where listing_id=$1",
      inactive: "update retailer_listings set active=false where id=$1",
      fingerprint:
        "update listing_normalizations set input_fingerprint='invalid' where listing_id=$1",
      version: "update listing_normalizations set normalization_version=999 where listing_id=$1",
      "price-unit": "update price_history set price_unit='KG' where listing_id=$1",
    };
    await query(updates[failure]!, [metro.id]);
    const result = await read({ priceMode: "benefits" });
    expect(result).toMatchObject({ totalProducts: 1, totalOffers: 1 });
    expect(result.products[0]).toMatchObject({
      retailerCount: 1,
      ordinaryOffer: { currentPriceCents: 1290, available: null },
    });
    expect(result.products[0]?.offers[0]?.retailerId).toBe("plaza-vea");
  });

  it.each(["manual", "obsolete", "revoked"] as const)(
    "never groups rejected %s associations",
    async (failure) => {
      const milk = await seedPublicProduct("identity", "Leche Gloria Light Lata 390g");
      const updates = {
        manual: "update canonical_product_listings set method='manual' where listing_id=$1",
        obsolete: "update canonical_product_listings set matching_version=999 where listing_id=$1",
        revoked: "update canonical_product_listings set confidence=0 where listing_id=$1",
      };
      await query(updates[failure], [milk.rows[0]!.id]);
      const result = await read();
      expect(result).toMatchObject({ totalProducts: 2, totalOffers: 2 });
      expect(result.products.every((product) => product.canonicalId === null)).toBe(true);
    },
  );

  it("separates ordinary minima from benefits, handles expiry and keeps unknown stock", async () => {
    const tottus = {
      ...observation("benefit-tottus", 0, 1090),
      title: "Leche Gloria Light Lata 390g",
      sourceBrand: "Gloria",
      conditionalOffers: [
        {
          programKey: "cmr" as const,
          conditionType: "payment_card" as const,
          conditionLabel: "Requiere tarjeta CMR" as const,
          priceCents: 890,
          observedAt: publicNow,
        },
      ],
    };
    const metro = {
      ...tottus,
      retailer: "metro" as const,
      externalId: "benefit-metro",
      currentPriceCents: 990,
      url: "https://www.metro.pe/milk/p",
      conditionalOffers: [],
      available: true,
    };
    for (const value of [tottus, metro]) {
      await persistListings(db, value.retailer, [value]);
      await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    }
    const rows = await harness.matchingRows([tottus.externalId, metro.externalId]);
    await persistMatching(db, rows, await evaluatePairs(db, [[rows[0]!, rows[1]!]]));
    await seedGeneric("Leche Gloria Entera Lata 390g", 950);
    const standard = await read({ sort: "total-price" });
    const benefits = await read({ sort: "total-price", priceMode: "benefits" });
    expect(standard.products[0]?.canonicalId).toBeNull();
    const product = benefits.products[0]!;
    expect(product).toMatchObject({
      retailerCount: 2,
      ordinaryOffer: { retailerId: "metro", currentPriceCents: 990 },
      rankingOffer: { retailerId: "tottus", available: null },
      ranking: { priceCents: 890, condition: { conditionLabel: "Requiere tarjeta CMR" } },
    });
    expect(product.lowestBenefit?.benefit.priceCents).toBe(890);
    expect(product.unitPrice).toEqual(product.rankingOffer.unitPrice);
    expect((await read({ retailer: "metro", priceMode: "benefits" })).products[0]).toMatchObject({
      ranking: { priceCents: 990, condition: null },
      lowestBenefit: null,
      retailerCount: 1,
    });
    await query("update retailer_listing_offers set ends_at=$1", [publicNow.toISOString()]);
    const expired = await read({ sort: "total-price", priceMode: "benefits" });
    expect(expired.products.map((result) => result.id)).toEqual(
      standard.products.map((result) => result.id),
    );
    expect(expired.products[1]).toMatchObject({
      ranking: { priceCents: 990, condition: null },
      lowestBenefit: null,
    });
  });

  it("keeps a changed derived identity separate after ingestion and normalization revoke its link", async () => {
    await seedPublicProduct("derived", "Leche Gloria Light Lata 390g");
    await persistListings(db, "metro", [
      {
        ...observation("derived-metro", 5),
        retailer: "metro",
        title: "Leche Gloria Entera Lata 390g",
        sourceBrand: "Gloria",
        url: "https://www.metro.pe/milk/p",
        available: true,
      },
    ]);
    await persistCatalogNormalizations(db, await catalogRows("derived-metro"));
    const result = await read();
    expect(result).toMatchObject({ totalProducts: 2, totalOffers: 2 });
    expect(result.products.every((product) => !product.canonicalId)).toBe(true);
    expect(
      result.products.flatMap((product) => product.offers).map((offer) => offer.available),
    ).toEqual(expect.arrayContaining([true, null]));
  });
});
