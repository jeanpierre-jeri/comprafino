import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchFilters } from "@comprafino/core";
import { searchPublicProducts } from "./generic-offers.ts";
import { catalogTestContext, publicNow } from "./testing/catalog-fixtures.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("category search (explicit owned PostgreSQL schema)", () => {
  const harness = catalogTestContext();
  const { db, query, seedGeneric, seedPublicProduct } = harness;

  beforeAll(async () => {
    await harness.setup();
  }, 30_000);
  beforeEach(async () => {
    await harness.reset();
  }, 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  async function attachCategory(listingId: string, name: string, active = true) {
    const sourceId = randomUUID();
    await query(
      `insert into catalog_sources(id,retailer_id,source_key,name,url,active)
       select $1::uuid,retailer_id,$1::text,$2,'https://www.tottus.com.pe/tottus-pe/lista/CATG1/test',$3::boolean
       from retailer_listings where id=$4`,
      [sourceId, name, String(active), listingId],
    );
    await query("insert into catalog_source_listings(source_id,listing_id) values($1,$2)", [
      sourceId,
      listingId,
    ]);
  }

  it("browses acquired paths without title guesses, duplicate offers or missing-product demand", async () => {
    const milk = await seedGeneric("Leche Auditcategoria 1L", 500);
    const yogurt = await seedGeneric("Yogurt Auditcategoria 1L", 600);
    const lexical = await seedGeneric("Leche Auditcategoria sin categoría 1L", 1);
    const inactive = await seedGeneric("Leche Auditcategoria categoría inactiva 1L", 2);
    const wrong = await seedGeneric("Bebida Auditcategoria 1L", 3);
    await attachCategory(milk.id, "Lácteos / Leche");
    await attachCategory(milk.id, "Lácteos y Huevos / Leches");
    await attachCategory(yogurt.id, "Lácteos y Huevos / Yogures");
    await attachCategory(inactive.id, "Lácteos / Leche", false);
    await attachCategory(wrong.id, "Bebidas / Lácteos");

    const filters = searchFilters({ category: "lacteos-huevos" });
    const results = await searchPublicProducts(db, "", "relevance", publicNow, filters);
    expect(results.offers.map((offer) => offer.id)).toEqual([milk.id, yogurt.id]);
    expect(results.totalOffers).toBe(2);
    expect(results.discoveryRetailers).toEqual([]);
    const general = await searchPublicProducts(db, "auditcategoria", "relevance", publicNow);
    expect(general.offers.map((offer) => offer.id)).toContain(lexical.id);
    const emptyFilter = await searchPublicProducts(
      db,
      "auditcategoria",
      "relevance",
      publicNow,
      searchFilters({ category: "limpieza" }),
    );
    expect(emptyFilter.offers).toEqual([]);
    expect(emptyFilter.usefulResultCount).toBe(general.usefulResultCount);
    expect(emptyFilter.discoveryRetailers).toEqual(general.discoveryRetailers);
    expect(await query("select id from discovery_queries")).toEqual([]);
  });

  it("combines category with query, retailer, unit and price sorting before pagination", async () => {
    const listingIds: string[] = [];
    for (let index = 0; index < 34; index++) {
      const listing = await seedGeneric(`Detergente Auditcategoria Tipo ${index} 1L`, 500 + index);
      await attachCategory(listing.id, "Limpieza / Detergentes");
      listingIds.push(listing.id);
    }
    await seedGeneric("Detergente Auditcategoria fuera 1L", 1);
    const mass = await seedGeneric("Detergente Auditcategoria Polvo 1kg", 2);
    await attachCategory(mass.id, "Limpieza / Detergentes");
    const filters = searchFilters({
      category: "limpieza",
      retailer: "tottus",
      unit: "L",
      sort: "total-price",
    });
    const first = await searchPublicProducts(
      db,
      "auditcategoria",
      "total-price",
      publicNow,
      filters,
    );
    const second = await searchPublicProducts(
      db,
      "auditcategoria",
      "total-price",
      publicNow,
      filters,
      2,
    );
    expect(first.totalOffers).toBe(34);
    expect(first.offers).toHaveLength(30);
    expect(second.offers).toHaveLength(4);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect([...first.offers, ...second.offers].map((offer) => offer.id)).toEqual(listingIds);
    expect(first.availableUnits).toEqual(expect.arrayContaining(["L", "kg"]));
    const metro = await searchPublicProducts(
      db,
      "",
      "relevance",
      publicNow,
      searchFilters({ ...filters, retailer: "metro" }),
    );
    expect(metro.offers).toEqual([]);
    expect(metro.usefulResultCount).toBeGreaterThan(0);
  }, 30_000);

  it("filters exact groups before pagination and retains their full comparison across stores", async () => {
    // These earlier alphabetical groups fill the unfiltered first page. Category
    // admission must happen in SQL, before that page can hide the requested group.
    for (let index = 0; index < 21; index++) {
      await seedPublicProduct(`category-outside-${index}`, "Leche Gloria Descremada Caja 946ml");
    }
    const product = await seedPublicProduct("category-exact", "Leche Gloria Entera Caja 946ml");
    await attachCategory(product.rows[0]!.id, "Lácteos / Leche");
    const filters = searchFilters({ category: "lacteos-huevos" });
    const results = await searchPublicProducts(db, "", "relevance", publicNow, filters);
    expect(results.products.map((item) => item.id)).toEqual([product.id]);
    expect(results.products[0]!.retailerCount).toBe(2);
    expect(results.offers).toHaveLength(1);
    const excluded = await searchPublicProducts(
      db,
      "",
      "relevance",
      publicNow,
      searchFilters({ category: "limpieza" }),
    );
    expect(excluded.products).toEqual([]);
    await query("update canonical_product_listings set method='manual' where listing_id=$1", [
      product.rows[0]!.id,
    ]);
    expect((await searchPublicProducts(db, "", "relevance", publicNow, filters)).products).toEqual(
      [],
    );
  });

  it("keeps positive ordinary price, freshness and tri-state availability gates when browsing", async () => {
    const unknown = await seedGeneric("Bebida Auditcategoria 1L", 500);
    const unavailable = await seedGeneric("Bebida Auditcategoria Agotada 1L", 1);
    const stale = await seedGeneric("Bebida Auditcategoria Antigua 1L", 2);
    const zero = await seedGeneric("Bebida Auditcategoria Cero 1L", 3);
    for (const listing of [unknown, unavailable, stale, zero]) {
      await attachCategory(listing.id, "Aguas y Bebidas / Jugos");
    }
    await query("update retailer_listings set available=false where id=$1", [unavailable.id]);
    await query(
      "update retailer_listings set last_seen_at=last_seen_at-interval '40 hours',first_seen_at=first_seen_at-interval '40 hours' where id=$1",
      [stale.id],
    );
    await query("update price_history set current_price_cents=0 where listing_id=$1", [zero.id]);
    const results = await searchPublicProducts(
      db,
      "",
      "relevance",
      publicNow,
      searchFilters({ category: "bebidas" }),
    );
    expect(results.offers.map((offer) => offer.id)).toEqual([unknown.id]);
    expect(results.offers[0]!.available).toBeNull();
  });
});
