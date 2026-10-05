import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  shoppingListItemSchema,
  shoppingListSchema,
  shoppingListEvaluationSchema,
} from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { createTestQueryClient, closeLocalTestConnections } from "./test-query-client.ts";
import { testSchemaClient } from "./test-schema-client.ts";
import { seedShoppingListFixtures } from "./shopping-list-e2e-fixtures.ts";
import { evaluateCurrentShoppingList, evaluateCurrentShoppingItem } from "./shopping-list.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("batched current shopping snapshot", () => {
  const schema = `comprafino_e2e_${randomUUID().replaceAll("-", "")}`;
  const client = createTestQueryClient(
    url ?? "postgresql://unused@localhost/comprafino_test",
    process.env.COMPRAFINO_TEST_DATABASE_MODE,
  );
  const scoped = testSchemaClient(client, schema);
  const db = createDatabase({
    DATABASE_URL: url ?? "postgresql://unused@localhost/comprafino_test",
    COMPRAFINO_E2E_SCHEMA: schema,
    COMPRAFINO_TEST_DATABASE_MODE: process.env.COMPRAFINO_TEST_DATABASE_MODE,
  });
  let fixtures: Record<string, string> = {};
  const now = new Date();
  const make = (
    intent: "generic" | "preferred" | "strict",
    overrides: Record<string, unknown> = {},
  ) =>
    shoppingListItemSchema.parse({
      id: randomUUID(),
      intent,
      label: "Huevos",
      query: "huevos",
      canonicalId: intent === "generic" ? null : fixtures.preferred,
      substitutionProfile: "eggs:regular",
      quantityMode: "packages",
      quantity: { amount: 1, unit: "unit" },
      frequency: "weekly",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...(intent === "generic"
        ? { quantityMode: "normalized", quantity: { amount: 30, unit: "unit" } }
        : {}),
      ...overrides,
    });
  beforeAll(async () => {
    await client.query(`create schema "${schema}"`);
    const journal = z
      .object({ entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z_]+$/u) })) })
      .parse(
        JSON.parse(
          readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
        ) as unknown,
      );
    await scoped.transaction(
      journal.entries.flatMap(({ tag }) =>
        readFileSync(new URL(`../migrations/${tag}.sql`, import.meta.url), "utf8")
          .split("--> statement-breakpoint")
          .filter((s) => !s.trim().startsWith("CREATE EXTENSION"))
          .map((s) => scoped.query(s.replaceAll('"public".', `"${schema}".`))),
      ),
    );
    fixtures = await seedShoppingListFixtures(db, scoped);
  }, 30000);
  afterAll(async () => {
    await client.query(`drop schema if exists "${schema}" cascade`);
    await closeLocalTestConnections();
  });
  it("one batch evaluates all intents, preserves item evaluation, rejects quail and writes nothing", async () => {
    const list = shoppingListSchema.parse({
      version: 2,
      items: [make("generic"), make("preferred"), make("strict")],
    });
    const before = await scoped.query(
      "select (select count(*) from price_history) as history, (select count(*) from retailer_listings) as listings, (select count(*) from retailer_listing_offers) as benefits",
    );
    const batch = vi.spyOn(db, "batch");
    const result = await evaluateCurrentShoppingList(db, list, "standard");
    expect(batch).toHaveBeenCalledTimes(1);
    batch.mockRestore();
    expect(shoppingListEvaluationSchema.safeParse(result).success).toBe(true);
    for (const item of list.items)
      expect(result.evaluations.find((e) => e.itemId === item.id)).toEqual(
        await evaluateCurrentShoppingItem(db, item, "standard"),
      );
    expect(result.baskets[0]).toMatchObject({
      status: "complete",
      totalCostCents: 4970,
      retailerIds: ["metro"],
    });
    expect(result.baskets[1].totalCostCents).toBe(4770);
    expect(
      result.baskets.flatMap((p) => p.assignments).some((a) => a.option.title.includes("Codorniz")),
    ).toBe(false);
    expect(
      await scoped.query(
        "select (select count(*) from price_history) as history, (select count(*) from retailer_listings) as listings, (select count(*) from retailer_listing_offers) as benefits",
      ),
    ).toEqual(before);
    const benefits = await evaluateCurrentShoppingList(db, list, "benefits");
    expect(benefits.baskets[0]).toMatchObject({
      totalCostCents: 3870,
      ordinarySubtotalCents: 5970,
      retailerIds: ["tottus"],
    });
  });
  it("legacy zero ordinary states cannot become shopping or basket winners", async () => {
    // Simulate historical data accepted before Cleanup A; no constraints/history migration.
    const changed = z
      .array(z.object({ id: z.uuid(), listingId: z.uuid(), price: z.number() }))
      .parse(
        await scoped.query(
          "update price_history h set current_price_cents=0 from retailer_listings l where h.listing_id=l.id and l.external_id='shopping-preferred-metro' and h.valid_until is null returning h.id, l.id as \"listingId\", l.current_price_cents as price",
        ),
      );
    expect(changed).toHaveLength(1);
    try {
      for (const mode of ["standard", "benefits"] as const) {
        const list = shoppingListSchema.parse({
          version: 2,
          items: [make("generic"), make("preferred"), make("strict")],
        });
        const result = await evaluateCurrentShoppingList(db, list, mode);
        for (const evaluation of result.evaluations) {
          expect(evaluation.options.every((o) => o.ordinaryTotalCents > 0)).toBe(true);
          expect(evaluation.options.some((o) => o.id === changed[0]!.listingId)).toBe(false);
        }
        expect(
          result.baskets
            .flatMap((p) => p.assignments)
            .every((a) => a.option.ordinaryTotalCents > 0),
        ).toBe(true);
        for (const item of list.items)
          expect(result.evaluations.find((e) => e.itemId === item.id)).toEqual(
            await evaluateCurrentShoppingItem(db, item, mode),
          );
      }
    } finally {
      await scoped.query("update price_history set current_price_cents=$1 where id=$2", [
        changed[0]!.price,
        changed[0]!.id,
      ]);
    }
  });
  it("returns explicit incomplete coverage for null compatibility and missing canonical IDs", async () => {
    const list = shoppingListSchema.parse({
      version: 2,
      items: [
        make("generic", { substitutionProfile: null }),
        make("strict", { canonicalId: randomUUID() }),
      ],
    });
    const result = await evaluateCurrentShoppingList(db, list, "standard");
    expect(
      result.baskets.every(
        (p) =>
          p.status === "incomplete" &&
          p.missingItemIds.length === 2 &&
          p.marginalSavingsCents === null,
      ),
    ).toBe(true);
    const batch = vi.spyOn(db, "batch");
    const empty = await evaluateCurrentShoppingList(db, { version: 2, items: [] }, "standard");
    expect(batch).not.toHaveBeenCalled();
    expect(empty.baskets.every((p) => p.status === "empty")).toBe(true);
    batch.mockRestore();
  });
  it("keeps independent identity null and withholds invalid canonical associations", async () => {
    await scoped.query(
      "update canonical_product_listings set confidence=0.85 where canonical_product_id=$1",
      [fixtures.alternative!],
    );
    try {
      const list = shoppingListSchema.parse({
        version: 2,
        items: [make("generic"), make("strict", { canonicalId: fixtures.alternative })],
      });
      const result = await evaluateCurrentShoppingList(db, list, "standard");
      expect(result.baskets[2].assignments[0]?.option.canonicalId).toBeNull();
      expect(result.evaluations.find((e) => e.itemId === list.items[1]!.id)?.best).toBeNull();
    } finally {
      await scoped.query(
        "update canonical_product_listings set confidence=1 where canonical_product_id=$1",
        [fixtures.alternative!],
      );
    }
  });
  it("fails closed on stale normalization and inactive/unavailable listings", async () => {
    await scoped.query(
      "update retailer_listings set available=false where external_id like 'shopping-alternative-%'",
    );
    await scoped.query(
      "update retailer_listings set title='Huevos changed 15un' where external_id='shopping-preferred-metro'",
    );
    await scoped.query(
      "update retailer_listings set active=false where external_id='shopping-preferred-plaza-vea'",
    );
    try {
      const result = await evaluateCurrentShoppingList(
        db,
        { version: 2, items: [make("strict")] },
        "standard",
      );
      expect(result.baskets[0].assignments[0]?.option.retailerId).toBe("tottus");
    } finally {
      await scoped.query(
        "update retailer_listings set available=null where external_id like 'shopping-alternative-%'",
      );
      await scoped.query(
        "update retailer_listings set title=$1 where external_id='shopping-preferred-metro'",
        ["Huevos Bell's Bandeja 30un"],
      );
      await scoped.query(
        "update retailer_listings set active=true where external_id='shopping-preferred-plaza-vea'",
      );
    }
  });
  it("retains options beyond the presentation cutoff and rejects snapshot overflow", async () => {
    const listings = Array.from({ length: 992 }, (_, i) => ({
      retailer: "metro" as const,
      externalId: `basket-guard-${i}`,
      productId: `basket-guard-${i}`,
      title: "Arroz Blanco Guard 1kg",
      url: "https://www.metro.pe/rice/p",
      currentPriceCents: 500,
      currency: "PEN" as const,
      priceUnit: "UN" as const,
      observedAt: new Date(),
    }));
    await persistListings(db, "metro", listings);
    const rows = z
      .array(z.object({ id: z.uuid(), external_id: z.string() }))
      .parse(
        await scoped.query(
          "select id, external_id from retailer_listings where external_id like 'basket-guard-%'",
        ),
      );
    const ids = new Map(rows.map((r) => [r.external_id, r.id]));
    await persistCatalogNormalizations(
      db,
      listings.map((l) => ({ ...l, id: ids.get(l.externalId)!, retailerId: "metro" })),
    );
    // The writer now rejects new identities above 1000. Deliberately inject one
    // extra isolated row to retain the independent reader overflow regression.
    await scoped.query(`insert into retailer_listings select (jsonb_populate_record(null::retailer_listings,
      to_jsonb(l)||jsonb_build_object('id',gen_random_uuid(),'external_id','basket-guard-overflow'))).*
      from retailer_listings l where external_id='basket-guard-0'`);
    await scoped.query(`insert into listing_normalizations select (jsonb_populate_record(null::listing_normalizations,
      to_jsonb(n)||jsonb_build_object('listing_id',extra.id))).* from listing_normalizations n
      join retailer_listings l on l.id=n.listing_id cross join retailer_listings extra
      where l.external_id='basket-guard-0' and extra.external_id='basket-guard-overflow'`);
    await scoped.query(`insert into price_history select (jsonb_populate_record(null::price_history,
      to_jsonb(h)||jsonb_build_object('id',gen_random_uuid(),'listing_id',extra.id))).* from price_history h
      join retailer_listings l on l.id=h.listing_id cross join retailer_listings extra
      where l.external_id='basket-guard-0' and extra.external_id='basket-guard-overflow'`);
    await expect(
      evaluateCurrentShoppingList(db, { version: 2, items: [make("generic")] }, "standard"),
    ).rejects.toThrow("snapshot bound exceeded");
    await scoped.query(
      "update retailer_listings set active=false where external_id in ('basket-guard-0','basket-guard-1')",
    );
    expect(
      (await evaluateCurrentShoppingList(db, { version: 2, items: [make("generic")] }, "standard"))
        .baskets[0].status,
    ).toBe("complete");
    await scoped.query(
      "update retailer_listings set active=false where external_id like 'basket-guard-%'",
    );
  }, 30000);
});
