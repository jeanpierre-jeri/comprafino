import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import {
  registerCatalogSources,
  claimCatalogSource,
  completeCatalogPage,
  requestCatalogRefresh,
  failCatalogPage,
  inspectCatalogAcquisition,
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

    it("pauses homepage redirects for six hours without losing listings or allowing demand to bypass the pause", async () => {
      const source = {
        retailer: "tottus" as const,
        key: "CATG16682",
        name: "Papel",
        url: "https://www.tottus.com.pe/tottus-pe/lista/CATG16682/Papeles",
      };
      await registerCatalogSources(db, "tottus", [source]);
      const claim = await claimCatalogSource(db, "tottus");
      if (!claim) throw new Error("Missing claim");
      await persistListingsDetailed(db, "tottus", [observation("paused-paper", 1)]);
      await completeCatalogPage(db, claim, 1, 1, ["paused-paper"]);
      const next = await claimCatalogSource(db, "tottus");
      if (!next) throw new Error("Missing next claim");
      await failCatalogPage(db, next, "redirect_to_home");
      const rows = await scoped.query(
        "select id from retailer_listings where external_id='paused-paper'",
      );
      const id = rows[0]?.id;
      if (typeof id !== "string") throw new Error("Missing listing");
      await requestCatalogRefresh(db, [id]);
      await registerCatalogSources(db, "tottus", [source]);
      expect(await claimCatalogSource(db, "tottus")).toBeNull();
      expect(
        await scoped.query(
          "select cursor,error,next_eligible_at between now()+interval '5 hours' and now()+interval '6 hours' as paused from catalog_sources",
        ),
      ).toEqual([{ cursor: 1, error: "redirect_to_home", paused: true }]);
      expect((await inspectCatalogAcquisition(db))[0]?.paused_homepage_redirects).toBe(1);
      expect(
        await scoped.query(
          "select count(*)::int as count from retailer_listings where external_id='paused-paper'",
        ),
      ).toEqual([{ count: 1 }]);
      await scoped.query("update catalog_sources set next_eligible_at=now()-interval '1 second'");
      const retried = await claimCatalogSource(db, "tottus");
      expect(retried?.cursor).toBe(1);
      if (!retried) throw new Error("Missing periodic recheck");
      await failCatalogPage(db, retried, "redirect_to_home");
      await registerCatalogSources(db, "tottus", [
        { ...source, url: "https://www.tottus.com.pe/tottus-pe/lista/CATG16682/Nuevo-Papel" },
      ]);
      expect((await claimCatalogSource(db, "tottus"))?.cursor).toBe(0);
    });

    it("retains limited-page observations without claiming a complete category and recovers legacy cursors", async () => {
      const source = {
        retailer: "metro" as const,
        key: "1001303",
        name: "Vinagres",
        url: "https://www.metro.pe/api/catalog_system/pub/products/search?fq=C%3A%2F1700%2F1001294%2F1001303%2F&sc=1",
      };
      await registerCatalogSources(db, "metro", [source]);
      await persistListingsDetailed(db, "metro", [
        { ...observation("limited", 1), retailer: "metro", url: "https://www.metro.pe/limited/p" },
      ]);
      await scoped.query(
        "update catalog_sources set cursor=2500,cycle_products=2500,last_completed_at='2026-01-01T00:00:00Z'",
      );
      const claim = await claimCatalogSource(db, "metro");
      if (!claim) throw new Error("Missing boundary claim");
      await completeCatalogPage(db, claim, null, 20, ["limited"], 0, true);
      expect(
        await scoped.query(
          "select cursor,error,cycle_products,pages_observed,products_observed,last_completed_at='2026-01-01T00:00:00Z'::timestamptz as unchanged,next_eligible_at>now()+interval '19 hours' as paused from catalog_sources",
        ),
      ).toEqual([
        {
          cursor: 0,
          error: "pagination_limit",
          cycle_products: 0,
          pages_observed: 1,
          products_observed: 20,
          unchanged: true,
          paused: true,
        },
      ]);
      expect((await inspectCatalogAcquisition(db))[0]?.pagination_limited).toBe(1);
      expect(
        await scoped.query("select count(*)::int as count from catalog_source_listings"),
      ).toEqual([{ count: 1 }]);
      await expect(completeCatalogPage(db, claim, null, 20, [], 0, true)).rejects.toThrow(/lease/u);

      await scoped.query(
        "update catalog_sources set cursor=2520,next_eligible_at=now()-interval '1 second'",
      );
      const legacy = await claimCatalogSource(db, "metro");
      if (!legacy) throw new Error("Missing legacy claim");
      await failCatalogPage(db, legacy, "pagination_limit");
      expect(
        await scoped.query(
          "select cursor,error,last_completed_at='2026-01-01T00:00:00Z'::timestamptz as unchanged from catalog_sources",
        ),
      ).toEqual([{ cursor: 0, error: "pagination_limit", unchanged: true }]);
      await scoped.query("update catalog_sources set next_eligible_at=now()-interval '1 second'");
      const resumed = await claimCatalogSource(db, "metro");
      if (!resumed) throw new Error("Missing resumed claim");
      await completeCatalogPage(db, resumed, 20, 20, []);
      expect((await inspectCatalogAcquisition(db))[0]?.pagination_limited).toBe(1);
      const end = await claimCatalogSource(db, "metro");
      if (!end) throw new Error("Missing end claim");
      await completeCatalogPage(db, end, null, 8, []);
      expect((await inspectCatalogAcquisition(db))[0]?.pagination_limited).toBe(0);
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
