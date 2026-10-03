import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { NormalizedRetailerListing } from "@comprafino/core";
import { requireDatabaseUrl } from "./env.ts";
import { catalogRecordSchema, persistCatalogNormalizations } from "./catalog.ts";
import { persistListings } from "./ingestion.ts";
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
  // test adapter sets a transaction-local search_path before that same batch.
  const scopedClient = new Proxy(client, {
    get(target, property, receiver) {
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
});
