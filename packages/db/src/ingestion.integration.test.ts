import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon, NeonQueryPromise } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getCanonicalProductPriceHistory } from "./price-history.ts";
import { searchFilters } from "@comprafino/core";
import { normalizeCatalogListing } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import { requireDatabaseUrl } from "./env.ts";
import { catalogRecordSchema, persistCatalogNormalizations } from "./catalog.ts";
import { evaluateIndependentAudit } from "./matching-independent.ts";
import { evaluateMatching } from "./matching-evaluate.ts";
import { evaluatePairs, persistMatching } from "./matching.ts";
import type { MatchingSnapshot } from "./matching.ts";
import type { Acquisition } from "./ingestion.ts";
import { createIngestionStore, persistListings } from "./ingestion.ts";
import {
  getCanonicalProductComparison as queryComparison,
  searchCanonicalProducts as querySearch,
} from "./public-products.ts";
import { inspectOperations } from "./operations.ts";
import {
  recordDiscoveryForSearch,
  claimDiscoveryQueries,
  previewDiscoveryQueries,
  finishDiscoveryQuery,
  inspectDiscovery,
} from "./discovery.ts";
import * as schema from "./schema.ts";

import {
  knownListings,
  previewListingRefresh,
  claimListingRefresh,
  finishListingRefresh,
} from "./listing-refresh.ts";
import { coverageReport } from "./coverage.ts";
import { searchGenericProductOffers, searchPublicProducts } from "./generic-offers.ts";
const publicNow = new Date("2026-10-03T09:10:00Z");
const getCanonicalProductComparison = (...args: Parameters<typeof queryComparison>) =>
  queryComparison(args[0], args[1], publicNow);
const searchCanonicalProducts = (...args: Parameters<typeof querySearch>) =>
  querySearch(args[0], args[1], publicNow);
// Never load .env or fall back to DATABASE_URL. Every write is confined to a
// fresh schema; no public tables, retailer locks or live listing data are used.
const testUrl = process.env.TEST_DATABASE_URL;
const schemaName = `comprafino_test_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;
const observation = (
  externalId: string,
  minute: number,
  currentPriceCents = 1290,
): NormalizedRetailerListing => ({
  retailer: "tottus",
  externalId,
  productId: externalId,
  title: "Controlled PostgreSQL test listing",
  url: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
  currentPriceCents,
  regularPriceCents: 1490,
  currency: "PEN",
  priceUnit: "UN",
  observedAt: new Date(Date.UTC(2026, 9, 3, 9, minute)),
});
const stateSchema = z.array(
  z.object({
    current_price_cents: z.number().int(),
    regular_price_cents: z.number().int().nullable(),
    valid_from: z.coerce.date(),
    valid_until: z.coerce.date().nullable(),
  }),
);

describe.skipIf(!testUrl)("PostgreSQL persistence (requires explicit TEST_DATABASE_URL)", () => {
  const client = neon(
    testUrl
      ? requireDatabaseUrl({ DATABASE_URL: testUrl })
      : "postgresql://unused@localhost/unused",
  );
  const setPath = () => client.query("select set_config('search_path', $1, true)", [schemaName]);
  // Keep persistListings and Drizzle's real batch transaction intact. The only
  // test adapter sets a transaction-local search_path before batches AND single
  // Drizzle queries (run start/finish must never fall through to public).
  const scopedClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<typeof client.query>) => {
          const nativeQuery = target.query(...args);
          // Preserve Neon's lazy query object for batch(), but scope direct await.
          return new NeonQueryPromise<boolean, boolean, unknown>(
            async () => {
              const results = await client.transaction(
                [setPath(), target.query(args[0], args[1])],
                args[2],
              );
              return results[1];
            },
            nativeQuery.queryData,
            nativeQuery.opts,
          );
        };
      }
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (
        queries: Parameters<typeof client.transaction>[0],
        options: Parameters<typeof client.transaction>[1],
      ) => {
        if (typeof queries === "function") throw new Error("Test adapter expects batch queries");
        const results = await client.transaction([setPath(), ...queries], options);
        return results.slice(1);
      };
    },
  });
  const db = drizzle(scopedClient, { schema });
  let created = false;
  async function query(text: string, params: string[] = []) {
    const results = await client.transaction([setPath(), client.query(text, params)]);
    const rows = results[1];
    if (!rows) throw new Error("Missing isolated query result");
    return rows;
  }
  async function states(externalId: string) {
    return stateSchema.parse(
      await query(
        `select h.current_price_cents, h.regular_price_cents, h.valid_from, h.valid_until
       from price_history h join retailer_listings l on l.id = h.listing_id
       where l.external_id = $1 order by h.valid_from`,
        [externalId],
      ),
    );
  }

  beforeAll(async () => {
    const journal = z
      .object({ entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z_]+$/u) })) })
      .parse(
        JSON.parse(
          readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
        ) as unknown,
      );
    const statements = journal.entries.flatMap(({ tag }) =>
      readFileSync(new URL(`../migrations/${tag}.sql`, import.meta.url), "utf8")
        .split("--> statement-breakpoint")
        .filter((text) => !text.trim().startsWith("CREATE EXTENSION"))
        .map((text) => client.query(text.replaceAll('"public".', `${quotedSchema}.`))),
    );
    await client.transaction([
      client.query(`create schema ${quotedSchema}`),
      setPath(),
      ...statements,
    ]);
    created = true;
  }, 30_000);
  afterAll(async () => {
    // Only the random schema successfully created by this suite can be dropped.
    if (created) await client.query(`drop schema ${quotedSchema} cascade`);
  }, 30_000);

  it("distinguishes latest attempt from success and preserves last-good price on failure", async () => {
    const store = createIngestionStore(db);
    const first = await store.start("metro");
    const listing = { ...observation("operations-last-good", 0), retailer: "metro" as const };
    await store.persist("metro", [listing]);
    await store.finish(first, { status: "success", fetched: 1, persisted: 1, changed: 1 });
    const before = await states(listing.externalId);
    const failed = await store.start("metro");
    // Explicit times make ordering deterministic, independent of DB clock resolution.
    await query("update ingestion_runs set started_at=$1 where id=$2", [
      "2026-10-03T10:00:00Z",
      first,
    ]);
    await query("update ingestion_runs set started_at=$1 where id=$2", [
      "2026-10-03T11:00:00Z",
      failed,
    ]);
    await store.finish(failed, {
      status: "failed",
      fetched: 0,
      persisted: 0,
      changed: 0,
      error: "postgres://secret@internal/db",
    });
    const operations = await inspectOperations(db, new Date("2026-10-04T11:00:00Z"));
    const metro = operations.find((r) => r.retailer === "metro");
    expect(metro).toMatchObject({
      latestAttempt: { id: failed, status: "failed" },
      latestSuccess: { id: first, status: "success" },
      freshness: "delayed",
      ageHours: 25,
    });
    expect(JSON.stringify(operations)).not.toContain("secret");
    expect(await states(listing.externalId)).toEqual(before);
    const persisted = z
      .array(z.object({ current_price_cents: z.number().int(), last_seen_at: z.coerce.date() }))
      .parse(
        await query(
          "select current_price_cents,last_seen_at from retailer_listings where external_id=$1",
          [listing.externalId],
        ),
      );
    expect(persisted).toEqual([{ current_price_cents: 1290, last_seen_at: listing.observedAt }]);
  }, 30_000);

  it("keeps unchanged observations idempotent and closes/opens a changed price", async () => {
    const initial = observation("transition", 0);
    expect(await persistListings(db, "tottus", [initial])).toEqual({ persisted: 1, changed: 1 });
    expect(await states(initial.externalId)).toEqual([
      {
        current_price_cents: 1290,
        regular_price_cents: 1490,
        valid_from: initial.observedAt,
        valid_until: null,
      },
    ]);
    expect(await persistListings(db, "tottus", [observation("transition", 1)])).toEqual({
      persisted: 1,
      changed: 0,
    });
    expect(await states("transition")).toHaveLength(1);
    const changed = observation("transition", 2, 1090);
    expect(await persistListings(db, "tottus", [changed])).toEqual({ persisted: 1, changed: 1 });
    const history = await states("transition");
    expect(history).toEqual([
      {
        current_price_cents: 1290,
        regular_price_cents: 1490,
        valid_from: initial.observedAt,
        valid_until: changed.observedAt,
      },
      {
        current_price_cents: 1090,
        regular_price_cents: 1490,
        valid_from: changed.observedAt,
        valid_until: null,
      },
    ]);
    expect(history.filter((state) => state.valid_until === null)).toHaveLength(1);
    for (const minute of [0, 2]) {
      expect(await persistListings(db, "tottus", [observation("transition", minute, 990)])).toEqual(
        { persisted: 0, changed: 0 },
      );
    }
    expect(await states("transition")).toEqual(history);
  }, 30_000);

  it("rolls back listing changes and closed history when the final insert fails", async () => {
    await persistListings(db, "tottus", [observation("rollback", 0)]);
    const beforeListings = await query("select * from retailer_listings where external_id = $1", [
      "rollback",
    ]);
    const beforeHistory = await states("rollback");
    // Force a real constraint failure only in this isolated schema, after the
    // upsert and history-close statements have executed. No production hooks.
    await query(
      "alter table price_history add constraint test_reject_changed_price check (current_price_cents <> 990)",
    );
    try {
      await expect(
        persistListings(db, "tottus", [
          observation("rollback", 1, 990),
          observation("rollback-new", 1),
        ]),
      ).rejects.toMatchObject({ code: "23514", constraint: "test_reject_changed_price" });
      expect(
        await query("select * from retailer_listings where external_id = $1", ["rollback"]),
      ).toEqual(beforeListings);
      expect(await states("rollback")).toEqual(beforeHistory);
      expect(
        await query("select id from retailer_listings where external_id = $1", ["rollback-new"]),
      ).toEqual([]);
    } finally {
      await query("alter table price_history drop constraint test_reject_changed_price");
    }
  }, 30_000);

  it("serializes concurrent writers without duplicate listings or broken transitions", async () => {
    const initial = observation("concurrent", 0);
    const duplicates = await Promise.all([
      persistListings(db, "tottus", [initial]),
      persistListings(db, "tottus", [initial]),
    ]);
    expect(duplicates.reduce((sum, result) => sum + result.changed, 0)).toBe(1);
    expect(await states("concurrent")).toHaveLength(1);
    const attempts = await Promise.all([
      persistListings(db, "tottus", [observation("concurrent", 1, 1190)]),
      persistListings(db, "tottus", [observation("concurrent", 2, 1090)]),
    ]);
    const history = await states("concurrent");
    // Either intermediate observation can acquire the lock first. The newest
    // observation must win in both orders, with strictly contiguous intervals.
    expect(history).toHaveLength(1 + attempts.reduce((sum, result) => sum + result.changed, 0));
    expect(history.filter((state) => state.valid_until === null)).toHaveLength(1);
    expect(history.at(-1)).toMatchObject({ current_price_cents: 1090, valid_until: null });
    for (let index = 0; index < history.length - 1; index++) {
      expect(history[index]?.valid_until).toEqual(history[index + 1]?.valid_from);
      expect(history[index]!.valid_until!.getTime()).toBeGreaterThan(
        history[index]!.valid_from.getTime(),
      );
    }
    expect(
      await query(
        "select current_price_cents, last_seen_at from retailer_listings where external_id = $1",
        ["concurrent"],
      ),
    ).toHaveLength(1);
    const current = z
      .array(z.object({ current_price_cents: z.number(), last_seen_at: z.coerce.date() }))
      .parse(
        await query(
          "select current_price_cents, last_seen_at from retailer_listings where external_id = $1",
          ["concurrent"],
        ),
      );
    expect(current).toEqual([
      { current_price_cents: 1090, last_seen_at: observation("concurrent", 2).observedAt },
    ]);
  }, 30_000);
  async function catalogRows(externalId: string) {
    return z.array(catalogRecordSchema).parse(
      await query(
        `select id, retailer_id as "retailerId", title, price_unit as "priceUnit",
      package_text as "packageText", source_brand as "sourceBrand", source_unit_multiplier::float8 as "sourceUnitMultiplier"
      from retailer_listings where external_id = $1`,
        [externalId],
      ),
    );
  }
  it("persists derived attributes idempotently and recomputes after metadata changes without touching history", async () => {
    const input = {
      ...observation("catalog", 0),
      title: "Leche Gloria 390g Paquete 6un",
      sourceBrand: "GLORIA",
      sourceUnitMultiplier: 1,
    };
    await persistListings(db, "tottus", [input]);
    const before = await states("catalog");
    let rows = await catalogRows("catalog");
    expect(rows[0]).toMatchObject({ sourceBrand: "GLORIA", sourceUnitMultiplier: 1 });
    expect(await persistCatalogNormalizations(db, rows)).toEqual({
      changed: 1,
      unchanged: 0,
      stale: 0,
    });
    const initial = await query("select * from listing_normalizations where listing_id = $1", [
      rows[0]!.id,
    ]);
    expect(initial).toMatchObject([
      {
        brand: "Gloria",
        brand_source: "source",
        quantity_value: 390,
        package_count: 6,
        total_quantity_value: 2340,
        pricing_basis: "unit",
      },
    ]);
    expect(await persistCatalogNormalizations(db, rows)).toEqual({
      changed: 0,
      unchanged: 1,
      stale: 0,
    });
    expect(
      await query("select * from listing_normalizations where listing_id = $1", [rows[0]!.id]),
    ).toEqual(initial);
    await persistListings(db, "tottus", [
      {
        ...input,
        title: "Leche Gloria 946ml Paquete 3un",
        observedAt: observation("catalog", 1).observedAt,
      },
    ]);
    rows = await catalogRows("catalog");
    expect(await persistCatalogNormalizations(db, rows)).toEqual({
      changed: 1,
      unchanged: 0,
      stale: 0,
    });
    expect(
      await query(
        "select quantity_value, quantity_unit, package_count, total_quantity_value from listing_normalizations where listing_id = $1",
        [rows[0]!.id],
      ),
    ).toEqual([
      { quantity_value: 946, quantity_unit: "ml", package_count: 3, total_quantity_value: 2838 },
    ]);
    expect(await states("catalog")).toEqual(before);
  }, 30_000);
  it("refuses stale reads and serializes repeated normalization writers", async () => {
    const input = { ...observation("catalog-stale", 0), title: "Leche Gloria 390g" };
    await persistListings(db, "tottus", [input]);
    const stale = await catalogRows("catalog-stale");
    await persistListings(db, "tottus", [
      {
        ...input,
        title: "Leche Gloria 946ml",
        observedAt: observation("catalog-stale", 1).observedAt,
      },
    ]);
    expect(await persistCatalogNormalizations(db, stale)).toEqual({
      changed: 0,
      unchanged: 0,
      stale: 1,
    });
    const fresh = await catalogRows("catalog-stale");
    const results = await Promise.all([
      persistCatalogNormalizations(db, fresh),
      persistCatalogNormalizations(db, fresh),
    ]);
    expect(results.reduce((sum, r) => sum + r.changed, 0)).toBe(1);
    expect(
      await query("select quantity_value from listing_normalizations where listing_id = $1", [
        fresh[0]!.id,
      ]),
    ).toEqual([{ quantity_value: 946 }]);
    await query(
      "update listing_normalizations set normalization_version = 2 where listing_id = $1",
      [fresh[0]!.id],
    );
    expect((await persistCatalogNormalizations(db, fresh)).changed).toBe(1);
  }, 30_000);
  it("rolls back a normalization batch when one derived row fails a constraint", async () => {
    for (const externalId of ["catalog-good", "catalog-rejected"])
      await persistListings(db, "tottus", [
        {
          ...observation(externalId, 0),
          title: externalId === "catalog-good" ? "Leche Gloria 390g" : "Leche Gloria 946ml",
        },
      ]);
    const rows = [
      ...(await catalogRows("catalog-good")),
      ...(await catalogRows("catalog-rejected")),
    ];
    const history = await query("select * from price_history order by id");
    await query(
      `alter table listing_normalizations add constraint test_reject_catalog check (listing_id <> '${rows[1]!.id}'::uuid)`,
    );
    try {
      await expect(persistCatalogNormalizations(db, rows)).rejects.toMatchObject({
        code: "23514",
        constraint: "test_reject_catalog",
      });
      expect(
        await query(
          "select * from listing_normalizations where listing_id in ($1, $2)",
          rows.map((r) => r.id),
        ),
      ).toEqual([]);
      expect(await query("select * from price_history order by id")).toEqual(history);
    } finally {
      await query("alter table listing_normalizations drop constraint test_reject_catalog");
    }
  }, 30_000);
  it("enforces quantity, count, total, brand and pricing invariants in PostgreSQL", async () => {
    await persistListings(db, "tottus", [
      { ...observation("catalog-constraints", 0), title: "Leche Gloria 390g" },
    ]);
    const rows = await catalogRows("catalog-constraints");
    await persistCatalogNormalizations(db, rows);
    for (const change of [
      "quantity_value = -1",
      "quantity_unit = null",
      "package_count = 0",
      "total_quantity_value = 391",
      "brand_source = null",
      "pricing_basis = 'kg', sold_by_weight = true",
    ]) {
      await expect(
        query(`update listing_normalizations set ${change} where listing_id = $1`, [rows[0]!.id]),
      ).rejects.toMatchObject({ code: "23514" });
    }
  }, 30_000);
  async function matchingRows(externalIds: string[]): Promise<MatchingSnapshot[]> {
    const records = z
      .array(
        z.object({ raw: z.string(), normalized: z.string(), priorGroupId: z.string().nullable() }),
      )
      .parse(
        await query(
          `select to_jsonb(l)::text as raw,to_jsonb(n)::text as normalized,c.canonical_product_id::text as "priorGroupId"
       from retailer_listings l join listing_normalizations n on n.listing_id=l.id
       left join canonical_product_listings c on c.listing_id=l.id where l.external_id=any($1::text[]) order by l.id`,
          [JSON.stringify(externalIds).replace("[", "{").replace("]", "}")],
        ),
      );
    return records.map((r) => {
      const raw = z
        .object({
          id: z.uuid(),
          retailer_id: z.enum(["tottus", "metro", "plaza-vea"]),
          title: z.string(),
          price_unit: z.enum(["UN", "KG"]),
          source_brand: z.string().nullable(),
        })
        .parse(JSON.parse(r.raw) as unknown);
      return {
        id: raw.id,
        retailer: raw.retailer_id,
        title: raw.title,
        attributes: normalizeCatalogListing({
          title: raw.title,
          priceUnit: raw.price_unit,
          sourceBrand: raw.source_brand,
        }),
        rawSnapshot: r.raw,
        normalizedSnapshot: r.normalized,
        priorGroupId: r.priorGroupId,
      };
    });
  }
  async function seedMatch(prefix: string) {
    for (const retailer of ["metro", "plaza-vea"] as const) {
      const value = {
        ...observation(`${prefix}-${retailer}`, 0),
        retailer,
        title: "Leche Gloria Entera Caja 946ml",
        sourceBrand: "Gloria",
      };
      await persistListings(db, retailer, [value]);
      await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    }
    const rows = await matchingRows([`${prefix}-metro`, `${prefix}-plaza-vea`]);
    const pairs = await evaluatePairs(db, [[rows[0]!, rows[1]!]]);
    return { rows, pairs };
  }
  it("queries range-clipped ordinary history for multiple verified retailers, excluding CMR and unlinked rows", async () => {
    const { rows, pairs } = await seedMatch("history-query");
    await persistMatching(db, rows, pairs);
    const links = z
      .array(z.object({ canonical_product_id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id from canonical_product_listings where listing_id=$1",
          [rows[0]!.id],
        ),
      );
    const id = links[0]!.canonical_product_id;
    const base = {
      ...observation("history-query-metro", 0, 1290),
      retailer: "metro" as const,
      title: "Leche Gloria Entera Caja 946ml",
      sourceBrand: "Gloria",
    };
    await persistListings(db, "metro", [
      {
        ...base,
        currentPriceCents: 1190,
        observedAt: new Date("2026-10-13T09:00:00Z"),
        conditionalOffers: [
          {
            programKey: "cmr",
            conditionType: "payment_card",
            conditionLabel: "Requiere tarjeta CMR",
            priceCents: 900,
            observedAt: new Date("2026-10-13T09:00:00Z"),
          },
        ],
      },
    ]);
    await persistListings(db, "metro", [
      {
        ...base,
        currentPriceCents: 1190,
        observedAt: new Date("2026-10-14T09:00:00Z"),
        conditionalOffers: [
          {
            programKey: "cmr",
            conditionType: "payment_card",
            conditionLabel: "Requiere tarjeta CMR",
            priceCents: 900,
            observedAt: new Date("2026-10-14T09:00:00Z"),
          },
        ],
      },
    ]);
    await persistListings(db, "metro", [
      { ...base, externalId: "history-unmatched", currentPriceCents: 1 },
    ]);
    const history = await getCanonicalProductPriceHistory(db, id, {
      range: "7d",
      now: new Date("2026-10-15T09:00:00Z"),
    });
    expect(history?.retailers).toHaveLength(2);
    const metro = history!.retailers.find((r) => r.retailerId === "metro")!;
    expect(metro.summary).toMatchObject({
      currentPriceCents: 1190,
      minimumPriceCents: 1190,
      maximumPriceCents: 1290,
      changeCount: 1,
      differenceCents: -100,
      lastChange: { fromCents: 1290, toCents: 1190 },
    });
    expect(metro.states).toHaveLength(2);
    expect(
      await query("select price_cents from retailer_listing_offers where listing_id=$1", [
        rows.find((r) => r.retailer === "metro")!.id,
      ]),
    ).toEqual([{ price_cents: 900 }]);
    expect(metro.states.map((state) => state.priceCents)).not.toContain(900);
    expect(metro.states[0]?.validFrom).toEqual(base.observedAt);
    expect(metro.states[1]?.validUntil).toBeNull();
    expect(metro.summary.points.map((p) => p.priceCents)).toEqual([1190, 1190]);
    expect(history!.retailers.find((r) => r.retailerId === "plaza-vea")?.summary.status).toBe(
      "empty",
    );
    const narrow = await getCanonicalProductPriceHistory(db, id, {
      range: "7d",
      now: new Date("2026-10-20T09:00:00Z"),
    });
    expect(narrow!.retailers.find((r) => r.retailerId === "metro")?.states).toHaveLength(1);
    expect(
      narrow!.retailers.find((r) => r.retailerId === "metro")?.summary.lastChange,
    ).toMatchObject({ fromCents: 1290, toCents: 1190 });
    expect(await getCanonicalProductPriceHistory(db, "malformed")).toBeNull();
    expect(await getCanonicalProductPriceHistory(db, randomUUID())).toBeNull();
    await query("update canonical_product_listings set confidence=0.85 where listing_id=$1", [
      rows[0]!.id,
    ]);
    expect(await getCanonicalProductPriceHistory(db, id)).toBeNull();
    await query(
      "update canonical_product_listings set method='manual',confidence=1 where listing_id=$1",
      [rows[0]!.id],
    );
    expect(await getCanonicalProductPriceHistory(db, id)).toBeNull();
  }, 30000);

  it("creates canonical links with real pg_trgm, idempotent concurrent reruns and SQL constraints", async () => {
    const { rows, pairs } = await seedMatch("matching");
    expect(pairs[0]!.result).toMatchObject({ decision: "auto_match", similarity: 1 });
    const results = await Promise.all([
      persistMatching(db, rows, pairs),
      persistMatching(db, rows, pairs),
    ]);
    expect(results.reduce((sum, r) => sum + r.productsCreated, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.linksCreated, 0)).toBe(2);
    const products = await query("select * from canonical_products order by id");
    const links = await query("select * from canonical_product_listings order by listing_id");
    expect(await persistMatching(db, rows, pairs)).toMatchObject({
      productsCreated: 0,
      linksCreated: 0,
      linksRemoved: 0,
      stale: false,
    });
    expect(await query("select * from canonical_products order by id")).toEqual(products);
    expect(await query("select * from canonical_product_listings order by listing_id")).toEqual(
      links,
    );
    await expect(
      query(
        "insert into canonical_product_listings select * from canonical_product_listings limit 1",
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      query("update canonical_product_listings set retailer_id='tottus' where listing_id=$1", [
        rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await persistListings(db, rows[0]!.retailer, [
      { ...observation("matching-duplicate-retailer", 0), retailer: rows[0]!.retailer },
    ]);
    const duplicate = (await catalogRows("matching-duplicate-retailer"))[0]!;
    await expect(
      query(
        `insert into canonical_product_listings(listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons)
      select $1::uuid,canonical_product_id,retailer_id,confidence,matching_version,method,reasons from canonical_product_listings where listing_id=$2`,
        [duplicate.id, rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "canonical_one_retailer" });
    await expect(
      query("update canonical_product_listings set confidence=1.1 where listing_id=$1", [
        rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await query(
      "update retailer_listings set title='Leche Entera Gloria Caja 946ml' where id=$1 or id=$2",
      rows.map((r) => r.id),
    );
    for (const externalId of ["matching-metro", "matching-plaza-vea"])
      await persistCatalogNormalizations(db, await catalogRows(externalId));
    const renamed = await matchingRows(["matching-metro", "matching-plaza-vea"]);
    const renamedPairs = await evaluatePairs(db, [[renamed[0]!, renamed[1]!]]);
    expect(await persistMatching(db, renamed, renamedPairs)).toMatchObject({
      productsCreated: 0,
      productsUpdated: 1,
      linksCreated: 0,
      linksRemoved: 0,
    });
  }, 30_000);
  it("refuses stale snapshots and scopes splitting groups; protects manual decisions and rebuilds obsolete links", async () => {
    const { rows, pairs } = await seedMatch("matching-rebuild");
    await persistMatching(db, rows, pairs);
    const fresh = await matchingRows(["matching-rebuild-metro", "matching-rebuild-plaza-vea"]);
    expect(await persistMatching(db, [fresh[0]!], [])).toMatchObject({
      stale: true,
      linksRemoved: 0,
    });
    await query("update canonical_product_listings set method='manual' where listing_id=$1", [
      fresh[0]!.id,
    ]);
    expect(await persistMatching(db, fresh, [])).toMatchObject({ stale: true, linksRemoved: 0 });
    await query("update canonical_product_listings set method='automatic' where listing_id=$1", [
      fresh[0]!.id,
    ]);
    await query(
      "update retailer_listings set title='Leche Gloria Entera Caja 1500ml' where id=$1",
      [fresh[0]!.id],
    );
    expect(await persistMatching(db, fresh, pairs)).toMatchObject({
      stale: true,
      linksCreated: 0,
      linksRemoved: 0,
    });
    await persistCatalogNormalizations(
      db,
      await catalogRows(
        fresh[0]!.retailer === "metro" ? "matching-rebuild-metro" : "matching-rebuild-plaza-vea",
      ),
    );
    const updated = await matchingRows(["matching-rebuild-metro", "matching-rebuild-plaza-vea"]);
    const rejected = await evaluatePairs(db, [[updated[0]!, updated[1]!]]);
    expect(rejected[0]!.result.decision).toBe("incompatible");
    expect(await persistMatching(db, updated, rejected)).toMatchObject({
      stale: false,
      linksRemoved: 2,
      productsRemoved: 1,
    });
  }, 30_000);
  it("rolls back the whole canonical assignment when an association constraint fails", async () => {
    const { rows, pairs } = await seedMatch("matching-rollback");
    const before = await query("select * from canonical_products order by id");
    await query(
      `alter table canonical_product_listings add constraint test_reject_match check(listing_id<>'${rows[0]!.id}'::uuid)`,
    );
    try {
      await expect(persistMatching(db, rows, pairs)).rejects.toMatchObject({ code: "23514" });
      expect(await query("select * from canonical_products order by id")).toEqual(before);
      expect(
        await query(
          "select * from canonical_product_listings where listing_id=$1 or listing_id=$2",
          rows.map((r) => r.id),
        ),
      ).toEqual([]);
    } finally {
      await query("alter table canonical_product_listings drop constraint test_reject_match");
    }
  }, 30_000);

  it("evaluates every reviewed real pair with PostgreSQL similarity and preserves automatic precision", async () => {
    const evaluated = await evaluateMatching(db);
    const metrics = evaluated.metrics.find((m) => m.split === "all")!;
    expect(metrics.pairs).toBe(66);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.truePositives).toBeGreaterThanOrEqual(11);
    expect(metrics.autoMatchPrecision).toBe(1);
  }, 30_000);
  it("reports independent-audit precision separately without modifying the frozen matcher", async () => {
    const audit = await evaluateIndependentAudit(db);
    expect(audit.canonicalGroupsReviewed).toBe(28);
    expect(audit.metrics.find((m) => m.stratum === "all")).toMatchObject({
      pairs: 105,
      truePositives: 34,
      falsePositives: 0,
      trueNegatives: 52,
      falseNegatives: 19,
      autoMatchPrecision: 1,
    });
    expect(audit.metrics.find((m) => m.stratum === "new_auto")).toMatchObject({
      pairs: 34,
      truePositives: 34,
      falsePositives: 0,
      autoMatchPrecision: 1,
    });
  }, 30_000);
  async function seedGeneric(title: string, cents: number, priceUnit: "UN" | "KG" = "UN") {
    const value = { ...observation(`generic-${randomUUID()}`, 0, cents), title, priceUnit };
    await persistListings(db, "tottus", [value]);
    await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    return (await catalogRows(value.externalId))[0]!;
  }
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
  async function seedPublicProduct(prefix: string, title: string, acquisition?: Acquisition) {
    for (const retailer of ["metro", "plaza-vea"] as const) {
      const value = {
        ...observation(`${prefix}-${retailer}`, 0),
        retailer,
        title,
        sourceBrand: "Gloria",
        url:
          retailer === "metro"
            ? "https://www.metro.pe/milk/p"
            : "https://www.plazavea.com.pe/milk/p",
      };
      await persistListings(db, retailer, [value], acquisition);
      await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    }
    const rows = await matchingRows([`${prefix}-metro`, `${prefix}-plaza-vea`]);
    await persistMatching(db, rows, await evaluatePairs(db, [[rows[0]!, rows[1]!]]));
    const links = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await query(
          "select canonical_product_id as id from canonical_product_listings where listing_id=$1::uuid",
          [rows[0]!.id],
        ),
      );
    return { id: links[0]!.id, rows };
  }
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
  async function resetDiscovery() {
    await query("delete from discovery_queries");
    await query("delete from discovery_daily_budget");
  }
  it("discovery safely deduplicates concurrent demand and increments counts", async () => {
    await resetDiscovery();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        recordDiscoveryForSearch(db, i % 2 ? " arroz  costeño " : "ARROZ COSTEÑO", 0),
      ),
    );
    const { queries } = await inspectDiscovery(db);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.normalizedQuery).toBe("arroz costeño");
    expect(queries[0]?.requestCount).toBe(12);
    expect(await recordDiscoveryForSearch(db, "aceite primor", 1)).toBe(false);
    expect(await recordDiscoveryForSearch(db, "??", 0)).toBe(false);
    expect((await inspectDiscovery(db)).queries).toHaveLength(1);
  }, 30_000);
  it("discovery preserves 24h cooldown despite demand, expires at the boundary and rejects stale completion", async () => {
    await resetDiscovery();
    await recordDiscoveryForSearch(db, "aceite primor", 0);
    const [claim] = await claimDiscoveryQueries(db, 1);
    if (!claim) throw new Error("Expected claim");
    await finishDiscoveryQuery(db, claim, { status: "no_results", resultCount: 0, error: null });
    expect((await inspectDiscovery(db)).queries[0]?.status).toBe("no_results");
    await recordDiscoveryForSearch(db, "ACEITE PRIMOR", 0);
    expect(await claimDiscoveryQueries(db, 30)).toEqual([]);
    expect(await previewDiscoveryQueries(db, 30)).toEqual([]);
    expect((await inspectDiscovery(db)).queries[0]?.requestCount).toBe(2);
    await query(
      "update discovery_queries set last_attempted_at=statement_timestamp()-interval '24 hours', next_eligible_at=statement_timestamp() where id=$1",
      [claim.id],
    );
    const [retry] = await claimDiscoveryQueries(db, 1);
    if (!retry) throw new Error("Expected retry");
    await finishDiscoveryQuery(db, claim, { status: "completed", resultCount: 1, error: null });
    expect((await inspectDiscovery(db)).queries[0]?.status).toBe("processing");
    await finishDiscoveryQuery(db, retry, {
      status: "failed",
      resultCount: 0,
      error: "Retailer discovery failed.",
    });
    expect((await inspectDiscovery(db)).queries[0]?.status).toBe("failed");
  }, 30_000);
  it("discovery shares the UTC daily cap across concurrent processors and retains prior-day accounting", async () => {
    await resetDiscovery();
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => recordDiscoveryForSearch(db, `arroz ${i}`, 0)),
    );
    await query(
      "insert into discovery_daily_budget(day,processed) values ((statement_timestamp() at time zone 'UTC')::date,29),((statement_timestamp() at time zone 'UTC')::date-1,30)",
    );
    const claims = await Promise.all([claimDiscoveryQueries(db, 3), claimDiscoveryQueries(db, 3)]);
    expect(claims.flat()).toHaveLength(1);
    expect((await inspectDiscovery(db)).stats.processedToday).toBe(30);
    expect(await claimDiscoveryQueries(db, 30)).toEqual([]);
    expect(await previewDiscoveryQueries(db, 30)).toEqual([]);
    await expect(query("update discovery_daily_budget set processed=31")).rejects.toThrow(
      /discovery_daily_cap/u,
    );
  }, 30_000);
  it("discovery prioritizes popularity then oldest eligibility and dry-run performs no writes", async () => {
    await resetDiscovery();
    await recordDiscoveryForSearch(db, "arroz viejo", 0);
    await recordDiscoveryForSearch(db, "arroz nuevo", 0);
    await recordDiscoveryForSearch(db, "arroz popular", 0);
    await recordDiscoveryForSearch(db, "ARROZ POPULAR", 0);
    await query(
      "update discovery_queries set next_eligible_at=statement_timestamp()-interval '2 hours' where normalized_query='arroz viejo'",
    );
    const before = await query("select * from discovery_queries order by id");
    expect(await previewDiscoveryQueries(db, 3)).toEqual([
      { query: "arroz popular" },
      { query: "arroz viejo" },
      { query: "arroz nuevo" },
    ]);
    expect(await query("select * from discovery_queries order by id")).toEqual(before);
    expect(await query("select * from discovery_daily_budget")).toEqual([]);
    const claims = await claimDiscoveryQueries(db, 3);
    expect(claims.map((c) => c.query).sort()).toEqual([
      "arroz nuevo",
      "arroz popular",
      "arroz viejo",
    ]);
    const popular = claims.find((c) => c.query === "arroz popular");
    if (!popular) throw new Error("Expected claim");
    await finishDiscoveryQuery(db, popular, { status: "completed", resultCount: 2, error: null });
    await query(
      "update discovery_queries set last_attempted_at=statement_timestamp()-interval '25 hours', next_eligible_at=statement_timestamp()-interval '1 hour' where id=$1",
      [popular.id],
    );
    // No new demand since the successful attempt: keep completed work dormant.
    await query(
      "update discovery_queries set first_requested_at=statement_timestamp()-interval '2 days',last_requested_at=statement_timestamp()-interval '2 days' where id=$1",
      [popular.id],
    );
    expect(await previewDiscoveryQueries(db, 3)).toEqual([]);
    await recordDiscoveryForSearch(db, "arroz popular", 0);
    expect(await previewDiscoveryQueries(db, 3)).toEqual([{ query: "arroz popular" }]);
  }, 30_000);
  it("preserves first acquisition identity and records category coverage without price-state duplication", async () => {
    await recordDiscoveryForSearch(db, "refresh controlled demand", 0);
    const demand = (await inspectDiscovery(db)).queries.find(
      (q) => q.normalizedQuery === "refresh controlled demand",
    )!;
    const value = { ...observation("70000001", 0), productId: "70000001" };
    await persistListings(db, "tottus", [value], { source: "discovery", queryId: demand.id });
    await persistListings(
      db,
      "tottus",
      [{ ...value, observedAt: observation("unused", 1).observedAt }],
      { source: "category" },
    );
    const listing = (await knownListings(db)).find((row) => row.externalId === value.externalId)!;
    expect(listing.firstSeenVia).toBe("discovery");
    expect(listing.lastCategoryObservedAt).toEqual(observation("unused", 1).observedAt);
    expect(await states(value.externalId)).toHaveLength(1);
    expect(
      (
        await query("select discovery_query_id from retailer_listings where id=$1", [listing.id])
      )[0],
    ).toMatchObject({ discovery_query_id: demand.id });
  }, 30000);
  it("targeted unchanged observations write zero states; a changed price opens exactly one", async () => {
    const value = { ...observation("70000002", 0), productId: "70000002" };
    await persistListings(db, "tottus", [value]);
    expect(
      await persistListings(
        db,
        "tottus",
        [{ ...value, observedAt: observation("unused", 1).observedAt }],
        { source: "targeted" },
      ),
    ).toMatchObject({ changed: 0 });
    expect(
      await persistListings(
        db,
        "tottus",
        [{ ...value, currentPriceCents: 990, observedAt: observation("unused", 2).observedAt }],
        { source: "targeted" },
      ),
    ).toMatchObject({ changed: 1 });
    expect(await states(value.externalId)).toHaveLength(2);
    expect(
      (await knownListings(db)).find((row) => row.externalId === value.externalId)!
        .lastCategoryObservedAt,
    ).toEqual(value.observedAt);
  }, 30000);
  it("serializes targeted admission and preserves history/freshness on unavailable or missing observations", async () => {
    const value = { ...observation("70000003", 0), productId: "70000003" };
    await persistListings(db, "tottus", [value]);
    const row = (await knownListings(db)).find((r) => r.externalId === value.externalId)!;
    const at = observation("unused", 3).observedAt;
    const claimed = await Promise.all([
      claimListingRefresh(db, row, at),
      claimListingRefresh(db, row, at),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    await finishListingRefresh(db, row, at, "unavailable");
    expect(
      (
        await query(
          "select available,last_seen_at,targeted_status from retailer_listings where id=$1",
          [row.id],
        )
      )[0],
    ).toMatchObject({ available: false, targeted_status: "unavailable" });
    expect((await knownListings(db)).find((r) => r.id === row.id)!.observedAt).toEqual(
      value.observedAt,
    );
    expect(await states(value.externalId)).toHaveLength(1);
    const current = (await knownListings(db)).find((r) => r.id === row.id)!;
    const next = observation("unused", 4).observedAt;
    expect(await claimListingRefresh(db, current, next)).toBe(true);
    await persistListings(
      db,
      "tottus",
      [{ ...value, observedAt: observation("unused", 5).observedAt }],
      { source: "targeted" },
    );
    await finishListingRefresh(db, current, next, "unavailable");
    // A newer successful observation supersedes the older negative result.
    expect(
      (await query("select available from retailer_listings where id=$1", [row.id]))[0],
    ).toMatchObject({ available: null });
    expect(await states(value.externalId)).toHaveLength(1);
    const before = await states(value.externalId);
    await finishListingRefresh(db, current, next, "not-found");
    expect(await states(value.externalId)).toEqual(before);
  }, 30000);
  it("reports demand, category gaps and freshness without writes; retains all-stale product pages", async () => {
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
  it("persists current benefits idempotently, updates/removes them and never changes ordinary history for benefits", async () => {
    const base = observation("conditional-state", 0, 1090);
    const cmr = {
      conditionType: "payment_card" as const,
      programKey: "cmr" as const,
      conditionLabel: "Requiere tarjeta CMR" as const,
      priceCents: 990,
      observedAt: base.observedAt,
    };
    const first = { ...base, conditionalOffers: [cmr] };
    await persistListings(db, "tottus", [first]);
    const before = await states(base.externalId);
    const read = () =>
      query(
        "select o.*,o.xmin::text as revision from retailer_listing_offers o join retailer_listings l on l.id=o.listing_id where l.external_id=$1",
        [base.externalId],
      );
    const initial = await read();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ price_cents: 990, program_key: "cmr" });
    await persistListings(db, "tottus", [{ ...first, observedAt: observation("x", 1).observedAt }]);
    expect(await read()).toEqual(initial);
    expect(await states(base.externalId)).toEqual(before);
    const changed = {
      ...first,
      observedAt: observation("x", 2).observedAt,
      conditionalOffers: [{ ...cmr, priceCents: 890 }],
    };
    await persistListings(db, "tottus", [changed]);
    expect((await read())[0]).toMatchObject({ price_cents: 890 });
    await persistListings(db, "tottus", [first]);
    await persistListings(db, "tottus", [{ ...changed, conditionalOffers: [] }]);
    expect((await read())[0]).toMatchObject({ price_cents: 890 });
    await persistListings(db, "tottus", [
      { ...first, observedAt: observation("x", 3).observedAt, conditionalOffers: [] },
    ]);
    expect(await read()).toEqual([]);
    expect(await states(base.externalId)).toEqual(before);
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
