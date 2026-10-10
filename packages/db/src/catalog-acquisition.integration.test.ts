import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import {
  registerCatalogSources,
  claimCatalogSource,
  completeCatalogPage,
  requestCatalogRefresh,
} from "./catalog-acquisition.ts";
import { normalizeChangedCatalog } from "./catalog.ts";
import { matchChangedCatalog } from "./matching.ts";
import { persistListingsDetailed } from "./ingestion.ts";
import { recordDiscoveryForSearch, claimDiscoveryQueries } from "./discovery.ts";
import { observation } from "./testing/catalog-fixtures.ts";
import { publicNow } from "./testing/catalog-fixtures.ts";
import { searchPublicProducts } from "./generic-offers.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "resumable catalog acquisition (owned TEST_DATABASE_URL)",
  () => {
    const harness = ownedTestDatabase({
      ...process.env,
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://unused@localhost/comprafino_test",
    });
    const { db, scoped } = harness;
    beforeAll(() => harness.setup(), 30_000);
    beforeEach(async () => {
      await harness.reset();
      await scoped.query("truncate catalog_sources cascade");
    });
    afterAll(async () => {
      await harness.dispose();
      await closeLocalTestConnections();
    });

    it("leases pages exclusively, rejects obsolete progress and retains demanded category paths", async () => {
      await registerCatalogSources(db, "tottus", [
        {
          retailer: "tottus",
          key: "CATG16682",
          name: "Papel higiénico",
          url: "https://www.tottus.com.pe/tottus-pe/lista/CATG16682/Papeles-Higienicos",
        },
      ]);
      const [first, other] = await Promise.all([
        claimCatalogSource(db, "tottus"),
        claimCatalogSource(db, "tottus"),
      ]);
      const claim = first ?? other;
      expect([first, other].filter(Boolean)).toHaveLength(1);
      if (!claim) throw new Error("Missing claim");
      await persistListingsDetailed(db, "tottus", [observation("paper", 1)]);
      await completeCatalogPage(db, claim, 1, 48, ["paper"]);
      await expect(completeCatalogPage(db, claim, 2, 48, [])).rejects.toThrow(/lease/u);
      const second = await claimCatalogSource(db, "tottus");
      expect(second?.cursor).toBe(1);
      if (!second) throw new Error("Missing resumed claim");
      await completeCatalogPage(db, second, null, 2, []);
      const rows = await scoped.query(
        "select cursor,last_cycle_products,pages_observed from catalog_sources",
      );
      expect(rows).toEqual([{ cursor: 0, last_cycle_products: 50, pages_observed: 2 }]);
      const ids = await scoped.query("select id from retailer_listings where external_id='paper'");
      const id = ids[0]?.id;
      if (typeof id !== "string") throw new Error("Missing listing");
      await requestCatalogRefresh(db, [id]);
      expect(
        await scoped.query(
          "select requested_at is not null as requested, next_eligible_at<=now()+interval '4 hours' as prioritized from catalog_sources",
        ),
      ).toEqual([{ requested: true, prioritized: true }]);
    });

    it("records missing-store demand with existing results and searches only those requested retailers", async () => {
      expect(await recordDiscoveryForSearch(db, "papel higienico", 40, ["tottus"])).toBe(true);
      const claims = await claimDiscoveryQueries(db, 1);
      expect(claims[0]?.requestedRetailers).toEqual(["tottus"]);
    });

    it("paginates current offers without losing results or changing numeric-unit search semantics", async () => {
      const rows = Array.from({ length: 77 }, (_, index) => ({
        ...observation(`page-${index}`, 1),
        retailer: "metro" as const,
        title: `Papel Higiénico Elite Variante ${index} 12 rollos`,
        sourceBrand: "Elite",
        url: `https://www.metro.pe/papel-${index}/p`,
      }));
      await persistListingsDetailed(db, "metro", rows);
      await normalizeChangedCatalog(db);
      const ids: string[] = [];
      for (const page of [1, 2, 3]) {
        const result = await searchPublicProducts(
          db,
          "papel higienico",
          "relevance",
          publicNow,
          undefined,
          page,
        );
        ids.push(...result.offers.map((offer) => offer.id));
        expect(result.totalOffers).toBe(77);
        expect(result.hasMore).toBe(page < 3);
        expect(result.discoveryRetailers).toEqual(["tottus", "plaza-vea", "makro"]);
      }
      expect(new Set(ids).size).toBe(77);
      await persistListingsDetailed(db, "tottus", [
        { ...observation("one-litre", 1), title: "Leche Gloria 1L", sourceBrand: "Gloria" },
        { ...observation("eleven-litres", 1), title: "Leche Gloria 11L", sourceBrand: "Gloria" },
      ]);
      await normalizeChangedCatalog(db);
      const milk = await searchPublicProducts(db, "leche gloria 1l", "relevance", publicNow);
      expect(milk.offers.map((offer) => offer.title)).toEqual(["Leche Gloria 1L"]);
      await persistListingsDetailed(db, "tottus", [
        {
          ...observation("diaeresis-paper", 1),
          title: "Papel Higiënico Elite 12 rollos",
          sourceBrand: "Elite",
        },
      ]);
      await normalizeChangedCatalog(db);
      const unicode = await searchPublicProducts(db, "papel higienico", "relevance", publicNow);
      expect(unicode.totalOffers).toBe(78);
    });

    it("normalizes and matches changed blocks, does no work on price-only updates and expands previous groups", async () => {
      const initial = {
        ...observation("incremental", 1),
        title: "Leche Gloria 1 L",
        sourceBrand: "Gloria",
      };
      await persistListingsDetailed(db, "tottus", [initial]);
      await persistListingsDetailed(db, "metro", [
        { ...initial, retailer: "metro", externalId: "peer", url: "https://www.metro.pe/leche/p" },
      ]);
      expect((await normalizeChangedCatalog(db)).changed).toBeGreaterThan(0);
      expect((await matchChangedCatalog(db)).associationsChanged).toBe(2);
      expect(await matchChangedCatalog(db)).toMatchObject({ processed: 0, candidates: 0 });
      const later = {
        ...initial,
        observedAt: new Date(initial.observedAt.getTime() + 60_000),
        currentPriceCents: initial.currentPriceCents + 10,
      };
      await persistListingsDetailed(db, "tottus", [later]);
      expect(await normalizeChangedCatalog(db)).toEqual({ processed: 0, changed: 0 });
      expect((await matchChangedCatalog(db)).processed).toBe(0);
      await persistListingsDetailed(db, "tottus", [
        {
          ...later,
          title: "Leche Otra 1 L",
          sourceBrand: "Otra",
          observedAt: new Date(later.observedAt.getTime() + 60_000),
        },
      ]);
      expect((await normalizeChangedCatalog(db)).changed).toBe(1);
      expect((await matchChangedCatalog(db)).associationsChanged).toBe(2);
      expect(
        await scoped.query("select count(*)::int as count from canonical_product_listings"),
      ).toEqual([{ count: 0 }]);
    });
  },
);
