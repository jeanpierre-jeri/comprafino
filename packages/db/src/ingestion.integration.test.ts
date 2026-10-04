import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon, NeonQueryPromise } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeCatalogListing } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import { requireDatabaseUrl } from "./env.ts";
import { catalogRecordSchema, persistCatalogNormalizations } from "./catalog.ts";
import { evaluateIndependentAudit } from "./matching-independent.ts";
import { evaluateMatching } from "./matching-evaluate.ts";
import { evaluatePairs, persistMatching } from "./matching.ts";
import type { MatchingSnapshot } from "./matching.ts";
import { createIngestionStore, persistListings } from "./ingestion.ts";
import { getCanonicalProductComparison, searchCanonicalProducts } from "./public-products.ts";
import { inspectOperations } from "./operations.ts";
import * as schema from "./schema.ts";

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
    return results[1];
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
  });

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
  async function seedPublicProduct(prefix: string, title: string) {
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
      await persistListings(db, retailer, [value]);
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
  it("searches trusted groups with normalized terms, deterministic ranking and variant preservation", async () => {
    const whole = await seedPublicProduct("public-whole", "Leche UHT Gloria Entera Caja 946ml");
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
      expect(await getCanonicalProductComparison(db, id)).toBeNull();
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
});
