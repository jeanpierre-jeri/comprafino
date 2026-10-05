import { getPublicRetailerListingDetail } from "./listing-detail.ts";
import { evaluateCurrentShoppingItem } from "./shopping-list.ts";
import { shoppingListItemSchema, inferGenericSubstitutionProfile } from "@comprafino/core";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { searchFilters } from "@comprafino/core";

import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { persistCatalogNormalizations } from "./catalog.ts";

import { evaluatePairs, persistMatching } from "./matching.ts";

import { persistListings } from "./ingestion.ts";
import {
  getCanonicalProductComparison as queryComparison,
  searchCanonicalProducts as querySearch,
} from "./public-products.ts";
import { recordDiscoveryForSearch, inspectDiscovery } from "./discovery.ts";

import { previewListingRefresh } from "./listing-refresh.ts";
import { coverageReport } from "./coverage.ts";
import { searchGenericProductOffers, searchPublicProducts } from "./generic-offers.ts";
import { catalogTestContext, observation, publicNow } from "./testing/catalog-fixtures.ts";
const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("PostgreSQL public-search (explicit TEST_DATABASE_URL)", () => {
  // Keep deliberate contention inside each case; cases start with independent data.
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  const {
    db,
    query,
    catalogRows,
    matchingRows,
    seedMatch,
    seedGeneric,
    seedPublicProduct,
    getCanonicalProductComparison,
    searchCanonicalProducts,
  } = harness;
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
  it("family search excludes properties and mismatches while preserving brand and size tokens", async () => {
    const sugar = await seedGeneric("Azúcar Blanca Auditfamily Bolsa 1kg", 650);
    const large = await seedGeneric("Azúcar Rubia Auditfamily Bolsa 5kg", 2800);
    await seedGeneric("Gaseosa Auditfamily sin Azúcar Botella 1L", 100);
    await seedGeneric("Azúcar Otramarca Bolsa 1kg", 500);
    expect(
      (await searchGenericProductOffers(db, "azucar auditfamily", "relevance", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([sugar.id, large.id]);
    expect(
      (await searchGenericProductOffers(db, "azúcar auditfamily 1kg", "relevance", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([sugar.id]);
    expect(
      await searchGenericProductOffers(db, "azúcar marcadesconocida 5kg", "relevance", publicNow),
    ).toEqual([]);
    expect(
      await searchGenericProductOffers(db, "auditfamily", "relevance", publicNow),
    ).toHaveLength(3);
    expect(
      (await searchGenericProductOffers(db, "azúcar auditfamily", "total-price", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([sugar.id, large.id]);
    expect(
      (await searchGenericProductOffers(db, "azúcar auditfamily", "unit-price", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([large.id, sugar.id]);
  }, 30000);
  it("current source-category evidence precedes title fallback without changing exact normalization", async () => {
    const fallback = await seedGeneric("Arroz Auditcategory 1kg", 500);
    const structured = await seedGeneric("Grano Auditcategory 1kg", 600);
    await query("update retailer_listings set category='J0101010203' where id=$1", [structured.id]);
    const historyBefore = await query(
      "select id,current_price_cents,valid_from,valid_until from price_history where listing_id=$1",
      [structured.id],
    );
    const normalizedBefore = await query(
      "select * from listing_normalizations where listing_id=$1",
      [structured.id],
    );
    const offers = await searchGenericProductOffers(
      db,
      "arroz auditcategory",
      "relevance",
      publicNow,
    );
    expect(offers.map((o) => o.id)).toEqual([structured.id, fallback.id]);
    expect(offers[0]!.family).toMatchObject({ family: "rice", origin: "source-category" });
    await query("update retailer_listings set category='J0101070507' where id=$1", [structured.id]);
    expect(
      (await searchGenericProductOffers(db, "arroz auditcategory", "relevance", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([fallback.id]);
    expect(
      await query("select * from listing_normalizations where listing_id=$1", [structured.id]),
    ).toEqual(normalizedBefore);
    expect(
      await query(
        "select id,current_price_cents,valid_from,valid_until from price_history where listing_id=$1",
        [structured.id],
      ),
    ).toEqual(historyBefore);
  }, 30000);
  it("family searches retain fresh-price eligibility and separate detergent unit dimensions", async () => {
    const fresh = await seedGeneric("Aceite Vegetal Auditoil 1L", 1000);
    const old = await seedGeneric("Aceite Vegetal Auditoil 500ml", 1);
    await seedGeneric("Filete de Atún Auditoil en Aceite Lata 140g", 1);
    await query(
      "update retailer_listings set last_seen_at=last_seen_at-interval '40 hours',first_seen_at=first_seen_at-interval '40 hours' where id=$1",
      [old.id],
    );
    expect(
      (await searchGenericProductOffers(db, "aceite auditoil", "unit-price", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([fresh.id]);
    await seedGeneric("Detergente Auditdetergent Polvo 1kg", 1000);
    await seedGeneric("Detergente Auditdetergent Líquido 1L", 500);
    expect(
      (
        await searchGenericProductOffers(db, "detergente auditdetergent", "unit-price", publicNow)
      ).map((o) => o.unitPrice!.dimension),
    ).toEqual(["mass", "volume"]);
    const tuna = await seedGeneric("Filete de Atún Audittuna Lata 140g", 500);
    const result = await searchGenericProductOffers(db, "atun audittuna", "unit-price", publicNow);
    expect(result.map((o) => o.id)).toEqual([tuna.id]);
    expect(result[0]!.unitPriceUnavailableReason).toBe("ambiguous-semantics");
  }, 30000);
  it("covered staple queries suppress discovery; a missing brand/size still records the complete demand", async () => {
    await seedGeneric("Harina Auditcoverage 1kg", 500);
    const covered = await searchPublicProducts(db, "harina auditcoverage", "relevance", publicNow);
    expect(covered.offers).toHaveLength(1);
    expect(
      await recordDiscoveryForSearch(db, "harina auditcoverage", covered.usefulResultCount),
    ).toBe(false);
    const specific = "harina marcadesconocida 5kg";
    const empty = await searchPublicProducts(db, specific, "relevance", publicNow);
    expect(empty.usefulResultCount).toBe(0);
    expect(await recordDiscoveryForSearch(db, specific, empty.usefulResultCount)).toBe(true);
    expect(
      await query("select normalized_query from discovery_queries where normalized_query=$1", [
        specific,
      ]),
    ).toEqual([{ normalized_query: specific }]);
  }, 30000);
  it("generic search includes independent one-store offers, uses open prices and sorts before limiting", async () => {
    const small = await seedGeneric("Huevos Auditgeneric Bandeja 15un", 990);
    const large = await seedGeneric("Huevos Auditgeneric Bandeja 30un", 1790);
    const missing = await seedGeneric("Huevos Auditgeneric Premium bandeja", 1290);
    expect(
      (await searchGenericProductOffers(db, "auditgeneric", "total-price", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([small.id, missing.id, large.id]);
    const sorted = await searchGenericProductOffers(db, "auditgeneric", "unit-price", publicNow);
    expect(sorted.map((o) => o.id)).toEqual([large.id, small.id, missing.id]);
    expect(sorted.every((o) => o.canonicalId === null)).toBe(true);
    await query("update retailer_listings set current_price_cents=1 where id=$1", [large.id]);
    expect(
      (await searchGenericProductOffers(db, "auditgeneric", "unit-price", publicNow))[0]!
        .currentPriceCents,
    ).toBe(1790);
    // Thirty cheaper options must be selected from the complete candidate set.
    const batch = Array.from({ length: 32 }, (_, i) => ({
      ...observation(`generic-limit-${i}`, 0, 100 + i),
      title: `Arroz Auditlimit bolsa 1kg`,
    }));
    await persistListings(db, "tottus", batch);
    await persistCatalogNormalizations(
      db,
      (await Promise.all(batch.map((v) => catalogRows(v.externalId)))).flat(),
    );
    const limited = await searchGenericProductOffers(db, "auditlimit", "total-price", publicNow);
    expect(limited).toHaveLength(30);
    expect(limited[29]!.currentPriceCents).toBe(129);
    await seedGeneric("Auditlimit leche 1L", 500);
    await seedGeneric("Auditlimit jar", 450);
    const unitLimited = await searchGenericProductOffers(db, "auditlimit", "unit-price", publicNow);
    expect(unitLimited).toHaveLength(30);
    expect(unitLimited.some((o) => o.unitPrice?.dimension === "volume")).toBe(true);
    expect(unitLimited.at(-1)!.unitPrice).toBeNull();
  }, 30000);
  it("keeps coarse roll prices separate and withholds tuna without changing history or normalization", async () => {
    const egg = await seedGeneric("Huevos Auditquality 12un", 1200);
    const paper = await seedGeneric("Papel Higiénico Auditquality 65m 12un", 600);
    const tuna = await seedGeneric("Filete de Atún Auditquality Pack 3 Und", 900);
    const before = await query(
      "select * from price_history where listing_id in($1::uuid,$2::uuid,$3::uuid) order by id",
      [egg.id, paper.id, tuna.id],
    );
    const offers = await searchGenericProductOffers(db, "auditquality", "unit-price", publicNow);
    expect(offers.map((o) => o.id)).toEqual([egg.id, paper.id, tuna.id]);
    expect(offers[0]!.unitPrice).toMatchObject({ basis: "item-count", quality: "strong" });
    expect(offers[1]!.unitPrice).toMatchObject({ basis: "roll", quality: "approximate" });
    expect(offers[2]!.unitPriceUnavailableReason).toBe("ambiguous-semantics");
    expect(await persistCatalogNormalizations(db, [egg, paper, tuna])).toEqual({
      changed: 0,
      unchanged: 3,
      stale: 0,
    });
    expect(
      await query(
        "select * from price_history where listing_id in($1::uuid,$2::uuid,$3::uuid) order by id",
        [egg.id, paper.id, tuna.id],
      ),
    ).toEqual(before);
  }, 30000);
  it("generic public eligibility rejects stale, unavailable, inactive, unnormalized and changed inputs", async () => {
    const rows = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => seedGeneric(`Arroz Auditeligibility ${i} bolsa 1kg`, 100 + i)),
    );
    await query(
      "update retailer_listings set last_seen_at=last_seen_at-interval '40 hours',first_seen_at=first_seen_at-interval '40 hours' where id=$1",
      [rows[0]!.id],
    );
    await query("update retailer_listings set available=false where id=$1", [rows[1]!.id]);
    await query("update retailer_listings set active=false where id=$1", [rows[2]!.id]);
    await query("delete from listing_normalizations where listing_id=$1", [rows[3]!.id]);
    await query(
      "update retailer_listings set title='Arroz Auditeligibility bolsa 5kg' where id=$1",
      [rows[4]!.id],
    );
    expect(
      await searchGenericProductOffers(db, "auditeligibility", "unit-price", publicNow),
    ).toEqual([]);
  }, 30000);
  it("generic ranking separates mass, volume, count and direct KG semantics", async () => {
    await seedGeneric("Auditdimensions aceite 500ml", 500);
    await seedGeneric("Auditdimensions arroz 500g", 500);
    await seedGeneric("Auditdimensions huevos 30un", 1790);
    await seedGeneric("Auditdimensions arroz por kg", 1890, "KG");
    const results = await searchGenericProductOffers(
      db,
      "auditdimensions",
      "unit-price",
      publicNow,
    );
    expect(results.map((o) => o.unitPrice!.dimension)).toEqual(["mass", "mass", "volume", "count"]);
    expect(results[1]!.unitPrice!.denominator).toBe(1n);
    expect(
      await searchGenericProductOffers(db, "auditdimensions' OR 1=1 --", "relevance", publicNow),
    ).toEqual([]);
  }, 30000);
  it("combined generic-only success suppresses discovery while true empty searches record demand", async () => {
    await seedGeneric("Huevos Auditdiscovery Bandeja 30un", 1790);
    const results = await searchPublicProducts(db, "auditdiscovery", "relevance", publicNow);
    expect(results.products).toHaveLength(0);
    expect(results.offers).toHaveLength(1);
    expect(await recordDiscoveryForSearch(db, "auditdiscovery", results.usefulResultCount)).toBe(
      false,
    );
    expect(
      await query("select id from discovery_queries where normalized_query='auditdiscovery'"),
    ).toEqual([]);
    const empty = await searchPublicProducts(db, "auditemptyzzzz", "relevance", publicNow);
    expect(await recordDiscoveryForSearch(db, "auditemptyzzzz", empty.usefulResultCount)).toBe(
      true,
    );
  }, 30000);
  it("public listing details retain unmatched listings, separate CMR, and reuse ordinary coverage", async () => {
    const row = await seedGeneric("Leche Gloria Auditdetail Entera 946ml", 650);
    const read = (now = publicNow) =>
      getPublicRetailerListingDetail(db, row.id, { now, range: "7d" });
    const detail = await read();
    expect(detail).toMatchObject({
      id: row.id,
      canonicalId: null,
      current: true,
      currentPriceCents: 650,
      regularPriceCents: 1490,
    });
    expect(detail?.history?.retailers).toHaveLength(1);
    expect(detail?.history?.retailers[0]?.summary.status).toBe("insufficient");
    expect(detail?.history?.retailers[0]?.coverage).toHaveLength(1);
    expect(detail).not.toHaveProperty("fingerprint");
    expect(detail).not.toHaveProperty("reasons");
    const observedAt = new Date("2026-10-03T09:05:00Z");
    await query(
      "insert into retailer_listing_offers(listing_id,condition_type,program_key,condition_label,price_cents,observed_at) values($1,'payment_card','cmr','Requiere tarjeta CMR',540,$2)",
      [row.id, observedAt.toISOString()],
    );
    // The fixture's listing identity is stable; CMR does not alter its ordinary state.
    const benefit = await read();
    expect(benefit?.conditionalOffers[0]?.priceCents).toBe(540);
    expect(benefit?.history?.retailers[0]?.summary.minimumPriceCents).toBe(650);
    expect((await read(new Date("2026-10-05T12:00:00Z")))?.current).toBe(false);
    expect((await read(new Date("2026-10-05T12:00:00Z")))?.conditionalOffers).toEqual([]);
    await query(
      "update price_history set valid_until=$2 where listing_id=$1 and valid_until is null",
      [row.id, publicNow.toISOString()],
    );
    expect(await read()).toMatchObject({ current: false, historicalOnly: true });
    await query("update retailer_listings set active=false where id=$1", [row.id]);
    expect(await read()).toBeNull();
    expect(await getPublicRetailerListingDetail(db, randomUUID())).toBeNull();
    expect(await getPublicRetailerListingDetail(db, "invalid")).toBeNull();
  });
  it("listing comparison association uses the unchanged canonical eligibility boundary", async () => {
    const { id, rows } = await seedPublicProduct("listing-associated", "Leche Gloria Entera 946ml");
    const read = () => getPublicRetailerListingDetail(db, rows[0]!.id, { now: publicNow });
    expect((await read())?.canonicalId).toBe(id);
    for (const change of ["confidence=0.89", "method='manual'", "matching_version=99"]) {
      await query(`update canonical_product_listings set ${change} where listing_id=$1`, [
        rows[1]!.id,
      ]);
      expect(await read()).toMatchObject({ canonicalId: null, current: true });
      await query(
        "update canonical_product_listings set confidence=1,method='automatic',matching_version=1 where listing_id=$1",
        [rows[1]!.id],
      );
    }
  });
  it("shopping queries retain independent generic offers without leaking uncertain canonical identities", async () => {
    const base = await seedPublicProduct("shopping-base", "Huevos Gloria Auditshopping Base 30un");
    const alternative = await seedPublicProduct(
      "shopping-alt",
      "Huevos Gloria Auditshopping Otra 30un",
    );
    await query(
      "update price_history set current_price_cents=1790 where listing_id=any($1::uuid[])",
      [`{${base.rows.map((r) => r.id).join(",")}}`],
    );
    await query(
      "update price_history set current_price_cents=1490 where listing_id=any($1::uuid[])",
      [`{${alternative.rows.map((r) => r.id).join(",")}}`],
    );
    await seedGeneric("Huevos Orgánicos Auditshopping Incompatible 30un", 1);
    const independent = await seedGeneric("Huevos Auditshopping Independiente 30un", 1690);
    await seedGeneric("Huevos de Codorniz Auditshopping 30un", 1);
    const discovery = await searchGenericProductOffers(
      db,
      "huevos auditshopping",
      "relevance",
      publicNow,
      searchFilters(),
      true,
    );
    expect(discovery.some((o) => o.title.includes("Codorniz"))).toBe(true);
    const makeItem = (intent: "generic" | "preferred" | "strict") =>
      shoppingListItemSchema.parse({
        id: randomUUID(),
        label: "Huevos",
        query: "huevos auditshopping",
        substitutionProfile: inferGenericSubstitutionProfile("huevos auditshopping", "unit"),
        intent,
        canonicalId: intent === "generic" ? null : base.id,
        quantity: { amount: 30, unit: "unit" },
        frequency: "weekly",
        createdAt: publicNow.toISOString(),
        updatedAt: publicNow.toISOString(),
      });
    const generic = await evaluateCurrentShoppingItem(
      db,
      makeItem("generic"),
      "standard",
      publicNow,
    );
    expect(generic.options.some((o) => o.title.includes("Codorniz"))).toBe(false);
    expect(generic.best).toMatchObject({
      canonicalId: alternative.id,
      totalCostCents: 1490,
      packages: 1,
    });
    const preferred = await evaluateCurrentShoppingItem(
      db,
      makeItem("preferred"),
      "standard",
      publicNow,
    );
    expect(preferred.options.some((o) => o.title.includes("Codorniz"))).toBe(false);
    expect(preferred).toMatchObject({
      preferred: { canonicalId: base.id },
      alternative: { canonicalId: alternative.id },
      savingsCents: 300,
    });
    const strict = await evaluateCurrentShoppingItem(db, makeItem("strict"), "standard", publicNow);
    expect(strict.options).toHaveLength(2);
    expect(strict.options.every((o) => o.canonicalId === base.id)).toBe(true);
    await query("update canonical_product_listings set confidence=0.85 where listing_id=$1", [
      alternative.rows[0]!.id,
    ]);
    expect(
      (await evaluateCurrentShoppingItem(db, makeItem("generic"), "standard", publicNow)).best,
    ).toMatchObject({ canonicalId: null, totalCostCents: 1490 });
    await query("update canonical_product_listings set confidence=1 where listing_id=$1", [
      alternative.rows[0]!.id,
    ]);
    await query(
      "update retailer_listings set first_seen_at='2026-09-01T00:00:00Z', last_seen_at='2026-09-01T00:00:00Z' where id=any($1::uuid[])",
      [`{${alternative.rows.map((r) => r.id).join(",")}}`],
    );
    expect(
      (await evaluateCurrentShoppingItem(db, makeItem("generic"), "standard", publicNow)).best,
    ).toMatchObject({ id: independent.id, canonicalId: null, totalCostCents: 1690 });
    await query(
      "update retailer_listings set first_seen_at='2026-09-01T00:00:00Z', last_seen_at='2026-09-01T00:00:00Z' where id=any($1::uuid[])",
      [`{${base.rows.map((r) => r.id).join(",")}}`],
    );
    expect(
      (await evaluateCurrentShoppingItem(db, makeItem("strict"), "standard", publicNow)).best,
    ).toBeNull();
    await query("update retailer_listings set active=false where external_id like 'shopping-%'");
    await query("update retailer_listings set active=false where id=$1", [independent.id]);
  }, 30000);

  it("incidental canonical groups do not suppress genuine staple demand; their exact route still works", async () => {
    const drink = await seedPublicProduct(
      "canonical-property",
      "Gaseosa Gloria sin Azúcar Auditcanonical 1L",
    );
    expect((await querySearch(db, "azúcar auditcanonical", publicNow)).map((p) => p.id)).toContain(
      drink.id,
    );
    const result = await searchPublicProducts(db, "azúcar auditcanonical", "relevance", publicNow);
    expect(result.usefulResultCount).toBe(0);
    expect(await queryComparison(db, drink.id, publicNow)).not.toBeNull();
    expect(
      await recordDiscoveryForSearch(db, "azúcar auditcanonical", result.usefulResultCount),
    ).toBe(true);
    const paste = await seedGeneric("Pasta Dental Auditpaste 100g", 500);
    expect(
      (await searchGenericProductOffers(db, "pasta dental auditpaste", "relevance", publicNow)).map(
        (o) => o.id,
      ),
    ).toEqual([paste.id]);
  }, 30000);
  it("searches trusted groups with normalized terms, deterministic ranking and variant preservation", async () => {
    const whole = await seedPublicProduct("public-whole", "Leche UHT Gloria Entera Caja 946ml");
    const generic = await searchGenericProductOffers(
      db,
      "gloria entera 946",
      "relevance",
      publicNow,
    );
    expect(generic.filter((o) => o.canonicalId === whole.id)).toHaveLength(2);
    expect(
      generic.filter((o) => o.canonicalId === whole.id).every((o) => o.retailerCount === 2),
    ).toBe(true);
    const light = await seedPublicProduct("public-light", "Leche UHT Gloria Light Caja 946ml");
    expect((await searchCanonicalProducts(db, "  GLORIA; 946ml ")).map((p) => p.id)).toEqual(
      expect.arrayContaining([whole.id, light.id]),
    );
    const exact = await searchCanonicalProducts(db, "Leche UHT Gloria Entera Caja 946ml");
    expect(exact[0]!.id).toBe(whole.id);
    const variants = await searchCanonicalProducts(db, "gloria light 946");
    expect(variants.map((p) => p.id)).toContain(light.id);
    expect(variants.map((p) => p.id)).not.toContain(whole.id);
    expect(await searchCanonicalProducts(db, "gloria 94")).toEqual([]);
    expect(await searchCanonicalProducts(db, "xylophone unmatched")).toEqual([]);
    expect(await searchCanonicalProducts(db, "gloria' OR 1=1 --")).toEqual([]);
    expect((await searchCanonicalProducts(db, "gloria")).map((p) => p.id)).toEqual(
      (await searchCanonicalProducts(db, "gloria")).map((p) => p.id),
    );
    expect((await searchCanonicalProducts(db, "gloria")).length).toBeLessThanOrEqual(20);
    await query("update canonical_products set display_name='Leche Entera UHT' where id=$1::uuid", [
      whole.id,
    ]);
    // Brand and associated normalized title still provide 946 ml identity text.
    expect((await searchCanonicalProducts(db, "gloria entera 946")).map((p) => p.id)).toContain(
      whole.id,
    );
  }, 30_000);
  it("reads only the current open state, credits ties, reference invariants and actual observation time", async () => {
    const { id, rows } = await seedPublicProduct("public-price", "Mantequilla Gloria Con Sal 180g");
    await persistListings(db, "metro", [
      {
        ...observation("public-price-metro", 2, 590),
        retailer: "metro",
        title: "Mantequilla Gloria Con Sal 180g",
        sourceBrand: "Gloria",
        regularPriceCents: 690,
        url: "https://www.metro.pe/butter/p",
      },
    ]);
    // The public query must read open history, not the listing's denormalized price.
    await query("update retailer_listings set current_price_cents=1 where id=$1::uuid", [
      rows.find((r) => r.retailer === "metro")!.id,
    ]);
    const product = await getCanonicalProductComparison(db, id);
    expect(product).toMatchObject({
      retailerCount: 2,
      lowestPriceCents: 590,
      cheapestRetailers: ["Metro"],
    });
    expect(product!.offers[0]).toMatchObject({
      retailerId: "metro",
      retailerName: "Metro",
      currentPriceCents: 590,
      regularPriceCents: 690,
      observedAt: observation("unused", 2).observedAt,
      url: "https://www.metro.pe/butter/p",
    });
    await query(
      "update price_history set current_price_cents=590,regular_price_cents=590 where listing_id=$1::uuid and valid_until is null",
      [rows.find((r) => r.retailer === "plaza-vea")!.id],
    );
    const tied = await getCanonicalProductComparison(db, id);
    expect(tied!.cheapestRetailers).toEqual(["Metro", "Plaza Vea"]);
    expect(tied!.offers[1]!.regularPriceCents).toBeNull();
    await query(
      "update price_history set regular_price_cents=580 where listing_id=$1::uuid and valid_until is null",
      [rows.find((r) => r.retailer === "plaza-vea")!.id],
    );
    expect((await getCanonicalProductComparison(db, id))!.offers[1]!.regularPriceCents).toBeNull();
  }, 30_000);
  it("excludes unmatched, manual, obsolete and low-confidence links and requires two usable retailers", async () => {
    const { id, rows } = await seedPublicProduct(
      "public-filter",
      "Yogurt Gloria Griego Con Miel 800g",
    );
    const listingId = rows[0]!.id;
    for (const update of ["method='manual'", "matching_version=99", "confidence=0.89"]) {
      await query(`update canonical_product_listings set ${update} where listing_id=$1::uuid`, [
        listingId,
      ]);
      expect(await getCanonicalProductComparison(db, id)).toBeNull();
      expect((await searchCanonicalProducts(db, "gloria miel 800")).map((p) => p.id)).not.toContain(
        id,
      );
      await query(
        "update canonical_product_listings set method='automatic',matching_version=1,confidence=1 where listing_id=$1::uuid",
        [listingId],
      );
    }
    for (const update of ["active=false", "available=false"]) {
      await query(`update retailer_listings set ${update} where id=$1::uuid`, [listingId]);
      const filtered = await getCanonicalProductComparison(db, id);
      expect(filtered?.cheapestRetailers.length ?? null).toBe(update === "active=false" ? null : 1);
      await query("update retailer_listings set active=true,available=true where id=$1::uuid", [
        listingId,
      ]);
    }
    await query(
      "update price_history set valid_until=valid_from+interval '1 minute' where listing_id=$1::uuid and valid_until is null",
      [listingId],
    );
    expect(await getCanonicalProductComparison(db, id)).toBeNull();
    await query("update price_history set valid_until=null where listing_id=$1::uuid", [listingId]);
    await query("delete from canonical_product_listings where listing_id=$1::uuid", [listingId]);
    expect(await getCanonicalProductComparison(db, id)).toBeNull();
    expect(await searchCanonicalProducts(db, "gloria miel 800")).toEqual([]);
    const beforeUnmatched = (await searchCanonicalProducts(db, "gloria 946")).map((p) => p.id);
    await seedMatch("public-unmatched");
    expect((await searchCanonicalProducts(db, "gloria 946")).map((p) => p.id)).toEqual(
      beforeUnmatched,
    );
    // A realistic high-scoring review remains outside the public catalog.
    for (const retailer of ["metro", "plaza-vea"] as const) {
      const value = {
        ...observation(`public-review-${retailer}`, 0),
        retailer,
        title:
          retailer === "metro"
            ? "Yogurt Griego Gloria Fresa 120g"
            : "Yogurt Batido Gloria Fresa 120g",
        sourceBrand: "Gloria",
      };
      await persistListings(db, retailer, [value]);
      await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    }
    const review = await matchingRows(["public-review-metro", "public-review-plaza-vea"]);
    const decisions = await evaluatePairs(db, [[review[0]!, review[1]!]]);
    expect(decisions[0]!.result.decision).toBe("review");
    expect(await searchCanonicalProducts(db, "gloria fresa 120")).toEqual([]);
    expect(await getCanonicalProductComparison(db, randomUUID())).toBeNull();
    expect(await getCanonicalProductComparison(db, "invalid")).toBeNull();
  }, 30_000);
  it("reports demand, category gaps and freshness without writes; retains all-stale product pages", async () => {
    await recordDiscoveryForSearch(db, "refresh controlled demand", 0);
    await recordDiscoveryForSearch(db, "leche gloria 750", 0);
    await recordDiscoveryForSearch(db, "leche gloria 750", 0);
    await recordDiscoveryForSearch(db, "leche gloria 750", 0);
    const demandQuery = (await inspectDiscovery(db)).queries.find(
      (q) => q.normalizedQuery === "leche gloria 750",
    )!;
    const { id, rows } = await seedPublicProduct(
      "refresh-public",
      "Leche Gloria Entera Bolsa 750ml",
      { source: "discovery", queryId: demandQuery.id },
    );
    const old = new Date("2026-09-29T09:00:00Z");
    await query(
      "update retailer_listings set first_seen_at=$1::timestamptz,last_seen_at=$1::timestamptz where id=$2::uuid or id=$3::uuid",
      [old.toISOString(), rows[0]!.id, rows[1]!.id],
    );
    const product = await getCanonicalProductComparison(db, id);
    expect(product).not.toBeNull();
    expect(product!.lowestPriceCents).toBeNull();
    expect(product!.cheapestRetailers).toEqual([]);
    const options = { limit: 1, dryRun: true, retailer: undefined, externalId: undefined };
    const before = await query("select * from retailer_listings order by id");
    await previewListingRefresh(db, options, publicNow);
    const report = await coverageReport(db, publicNow);
    expect(report.tooStale).toBeGreaterThanOrEqual(2);
    expect(report.demand.find((q) => q.query === "leche gloria 750")).toMatchObject({
      requests: 3,
      firstAcquisitionGroups: 1,
      currentlyMatchingPublicGroups: 1,
    });
    expect(report.publicWithoutCategoryObservation).toBeGreaterThanOrEqual(2);
    expect(
      report.recurringBrandsAndCategoriesOutsideObservedCoverage.find(
        (row) => row.brand === "gloria",
      ),
    ).toMatchObject({ queries: 1 });
    expect(report.demand.find((q) => q.query === "refresh controlled demand")?.requests).toBe(1);
    expect(await query("select * from retailer_listings order by id")).toEqual(before);
  }, 30000);
  it("public benefits ranking, retailer/unit filters and filtered-empty discovery preserve standard behavior", async () => {
    const first = {
      ...observation("conditional-search", 0, 1090),
      title: "Arroz Auditbenefits Bolsa 1kg",
      sourceBrand: "Auditbenefits",
      conditionalOffers: [
        {
          conditionType: "payment_card" as const,
          programKey: "cmr" as const,
          conditionLabel: "Requiere tarjeta CMR" as const,
          priceCents: 890,
          observedAt: publicNow,
        },
      ],
    };
    await persistListings(db, "tottus", [first]);
    await persistCatalogNormalizations(db, await catalogRows(first.externalId));
    const other = {
      ...first,
      externalId: "conditional-search-metro",
      retailer: "metro" as const,
      url: "https://www.metro.pe/arroz/p",
      currentPriceCents: 990,
      conditionalOffers: [],
    };
    await persistListings(db, "metro", [other]);
    await persistCatalogNormalizations(db, await catalogRows(other.externalId));
    const shoppingRows = await matchingRows([first.externalId, other.externalId]);
    await persistMatching(
      db,
      shoppingRows,
      await evaluatePairs(db, [[shoppingRows[0]!, shoppingRows[1]!]]),
    );
    const shoppingCanonicalId = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id as id from canonical_product_listings where listing_id=$1",
          [shoppingRows[0]!.id],
        ),
      )[0]!.id;
    const shoppingNeed = shoppingListItemSchema.parse({
      id: randomUUID(),
      intent: "strict",
      canonicalId: shoppingCanonicalId,
      label: "Arroz",
      query: "arroz auditbenefits",
      quantity: { amount: 2, unit: "kg" },
      frequency: "monthly",
      createdAt: publicNow.toISOString(),
      updatedAt: publicNow.toISOString(),
    });
    expect(
      (await evaluateCurrentShoppingItem(db, shoppingNeed, "standard", publicNow)).best,
    ).toMatchObject({ totalCostCents: 1980, condition: null });
    expect(
      (await evaluateCurrentShoppingItem(db, shoppingNeed, "benefits", publicNow)).best,
    ).toMatchObject({
      totalCostCents: 1780,
      ordinaryTotalCents: 2180,
      condition: "Requiere tarjeta CMR",
    });
    await query("delete from canonical_product_listings where listing_id=any($1::uuid[])", [
      `{${shoppingRows.map((r) => r.id).join(",")}}`,
    ]);
    const standard = await searchPublicProducts(db, "auditbenefits", "total-price", publicNow);
    expect(standard.offers[0]?.currentPriceCents).toBe(990);
    const benefits = await searchPublicProducts(
      db,
      "auditbenefits",
      "total-price",
      publicNow,
      searchFilters({ priceMode: "benefits", sort: "total-price" }),
    );
    expect(benefits.offers[0]).toMatchObject({
      currentPriceCents: 1090,
      ranking: { priceCents: 890, condition: { programKey: "cmr" } },
    });
    expect(benefits.offers[0]?.conditionalOffers[0]?.observedAt).toEqual(first.observedAt);
    const retailer = await searchPublicProducts(
      db,
      "auditbenefits",
      "unit-price",
      publicNow,
      searchFilters({ retailer: "tottus", unit: "kg", sort: "unit-price" }),
    );
    expect(retailer.offers).toHaveLength(1);
    expect(retailer.offers[0]?.retailerId).toBe("tottus");
    const empty = await searchPublicProducts(
      db,
      "auditbenefits",
      "relevance",
      publicNow,
      searchFilters({ retailer: "plaza-vea", unit: "L" }),
    );
    expect(empty.offers).toEqual([]);
    expect(empty.usefulResultCount).toBe(2);
    expect(await recordDiscoveryForSearch(db, "auditbenefits", empty.usefulResultCount)).toBe(
      false,
    );
    const matchRows = await matchingRows([first.externalId, other.externalId]);
    await persistMatching(db, matchRows, await evaluatePairs(db, [[matchRows[0]!, matchRows[1]!]]));
    const links = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id as id from canonical_product_listings where listing_id=$1",
          [matchRows[0]!.id],
        ),
      );
    expect(links).toHaveLength(1);
    const ordinary = await queryComparison(db, links[0]!.id, publicNow);
    const withBenefits = await queryComparison(db, links[0]!.id, publicNow, "benefits");
    expect(ordinary?.bestRanking).toMatchObject({
      priceCents: 990,
      retailers: ["Metro"],
      conditions: [],
    });
    expect(withBenefits?.bestRanking).toMatchObject({
      priceCents: 890,
      retailers: ["Tottus"],
      conditions: ["Requiere tarjeta CMR"],
    });
    expect(withBenefits?.lowestPriceCents).toBe(990);
    const stale = await queryComparison(
      db,
      links[0]!.id,
      new Date(publicNow.getTime() + 40 * 3600000),
      "benefits",
    );
    expect(stale?.bestRanking).toBeNull();
    expect(stale?.lowestBenefit).toBeNull();
    await query("update retailer_listing_offers set ends_at=$1", [publicNow.toISOString()]);
    const expired = await searchPublicProducts(
      db,
      "auditbenefits",
      "total-price",
      publicNow,
      searchFilters({ priceMode: "benefits" }),
    );
    expect(expired.offers[0]?.currentPriceCents).toBe(990);
  }, 30000);
});
