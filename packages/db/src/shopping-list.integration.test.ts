import { ownedTestDatabase } from "./testing/database.ts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  catalogPolicy,
  weekdayEvidenceWindow,
  shiftObservationDay,
  shoppingListItemSchema,
  shoppingListSchema,
  shoppingListEvaluationSchema,
} from "@comprafino/core";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { seedShoppingListFixtures } from "./shopping-list-e2e-fixtures.ts";
import { evaluateCurrentShoppingList, evaluateCurrentShoppingItem } from "./shopping-list.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("batched current shopping snapshot", () => {
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: url ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, scoped } = harness;
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
    await harness.setup();
  }, 30_000);
  beforeEach(async () => {
    await harness.reset();
    fixtures = await seedShoppingListFixtures(db, scoped);
  }, 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);
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

    for (const item of list.items) {
      expect(result.evaluations.find((e) => e.itemId === item.id)).toEqual(
        await evaluateCurrentShoppingItem(db, item, "standard"),
      );
    }

    expect(result.evaluations.every((evaluation) => evaluation.best?.available === null)).toBe(
      true,
    );
    expect(
      result.baskets.every((plan) =>
        plan.assignments.every(({ option }) => option.available === null),
      ),
    ).toBe(true);
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

        for (const item of list.items) {
          expect(result.evaluations.find((e) => e.itemId === item.id)).toEqual(
            await evaluateCurrentShoppingItem(db, item, mode),
          );
        }
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
    const existing = z
      .object({ count: z.number().int() })
      .parse((await scoped.query("select count(*)::int as count from retailer_listings"))[0]).count;
    const listings = Array.from(
      { length: catalogPolicy.retainedListingCap - existing },
      (_, i) => ({
        retailer: "metro" as const,
        externalId: `basket-guard-${i}`,
        productId: `basket-guard-${i}`,
        title: "Arroz Blanco Guard 1kg",
        url: "https://www.metro.pe/rice/p",
        currentPriceCents: 500,
        currency: "PEN" as const,
        priceUnit: "UN" as const,
        observedAt: new Date(),
      }),
    );
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
    // The writer now rejects new identities above the configured cap. Deliberately inject one
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
  it("weekday SQL uses real days, separates retailers/intent and ignores CMR and reference changes", async () => {
    const evaluationTime = new Date();
    const { start } = weekdayEvidenceWindow(evaluationTime);
    const listing = z
      .object({ id: z.uuid() })
      .parse(
        (
          await scoped.query(
            "select id from retailer_listings where external_id='shopping-preferred-tottus'",
          )
        )[0],
      );
    await scoped.query(
      "update canonical_product_listings set linked_at=$1::timestamptz where listing_id=$2::uuid",
      [`${start}T05:00:00Z`, listing.id],
    );
    await scoped.query("delete from listing_observation_days where listing_id=$1::uuid", [
      listing.id,
    ]);
    await scoped.query(
      "delete from price_history where listing_id=$1::uuid and valid_until is not null",
      [listing.id],
    );
    for (let index = 0; index < 28; index++) {
      const date = shiftObservationDay(start, index);
      const price = index % 7 === 2 ? 1000 : 1500;
      await scoped.query(
        `insert into price_history(listing_id,current_price_cents,currency,price_unit,valid_from,valid_until)
        values($1::uuid,$2,'PEN','UN',$3::timestamptz,$4::timestamptz)`,
        [listing.id, price, `${date}T05:00:00Z`, `${shiftObservationDay(date, 1)}T05:00:00Z`],
      );
      await scoped.query(
        `insert into listing_observation_days(listing_id,observation_date,first_observed_at,last_observed_at,observation_count)
        values($1::uuid,$2::date,$3::timestamptz,$4::timestamptz,2)`,
        [listing.id, date, `${date}T12:00:00Z`, `${date}T20:00:00Z`],
      );
    }
    const exact = make("strict");
    const generic = make("generic");
    const list = shoppingListSchema.parse({ version: 2, items: [exact, generic] });
    const result = await evaluateCurrentShoppingList(db, list, "standard", evaluationTime);
    const series = result.weekdayRecommendations[0]!.series;
    expect(series.find((row) => row.listingId === listing.id)?.pattern).toMatchObject({
      status: "recommended",
      weekday: 2,
      coveredDays: 28,
    });
    expect(
      series
        .filter((row) => row.listingId !== listing.id)
        .every((row) => row.pattern.status === "insufficient"),
    ).toBe(true);
    expect(result.weekdayRecommendations[1]!.series).toEqual([]);
    expect(
      (await evaluateCurrentShoppingList(db, list, "benefits", evaluationTime))
        .weekdayRecommendations,
    ).toEqual(result.weekdayRecommendations);

    // A reference-only transition preserves comparable ordinary observations.
    const referenceDay = shiftObservationDay(start, 1);
    await scoped.query(
      "update price_history set valid_until=$1::timestamptz where listing_id=$2::uuid and valid_from=$3::timestamptz",
      [`${referenceDay}T16:00:00Z`, listing.id, `${referenceDay}T05:00:00Z`],
    );
    await scoped.query(
      `insert into price_history(listing_id,current_price_cents,regular_price_cents,currency,price_unit,valid_from,valid_until)
      values($1::uuid,1500,2000,'PEN','UN',$2::timestamptz,$3::timestamptz)`,
      [
        listing.id,
        `${referenceDay}T16:00:00Z`,
        `${shiftObservationDay(referenceDay, 1)}T05:00:00Z`,
      ],
    );
    expect(
      (await evaluateCurrentShoppingList(db, list, "standard", evaluationTime))
        .weekdayRecommendations,
    ).toEqual(result.weekdayRecommendations);
    // Missing recorded states between actual observations are not bridged.
    await scoped.query(
      "update price_history set valid_until=$1::timestamptz where listing_id=$2::uuid and valid_from=$3::timestamptz",
      [`${referenceDay}T15:00:00Z`, listing.id, `${referenceDay}T05:00:00Z`],
    );
    expect(
      (
        await evaluateCurrentShoppingList(db, list, "standard", evaluationTime)
      ).weekdayRecommendations[0]!.series.find((row) => row.listingId === listing.id)?.pattern
        .coveredDays,
    ).toBe(27);
    await scoped.query(
      "update price_history set valid_until=$1::timestamptz where listing_id=$2::uuid and valid_from=$3::timestamptz",
      [`${referenceDay}T16:00:00Z`, listing.id, `${referenceDay}T05:00:00Z`],
    );
    // An ordinary intraday change makes this date unusable; it is never a daily average.
    await scoped.query(
      "update price_history set current_price_cents=1400 where listing_id=$1::uuid and valid_from=$2::timestamptz",
      [listing.id, `${referenceDay}T16:00:00Z`],
    );
    const mixed = await evaluateCurrentShoppingList(db, list, "standard", evaluationTime);
    expect(
      mixed.weekdayRecommendations[0]!.series.find((row) => row.listingId === listing.id)?.pattern,
    ).toMatchObject({ status: "insufficient", coveredDays: 27 });
    await scoped.query(
      "delete from listing_observation_days where listing_id=$1::uuid and observation_date=$2::date",
      [listing.id, start],
    );
    expect(
      (
        await evaluateCurrentShoppingList(db, list, "standard", evaluationTime)
      ).weekdayRecommendations[0]!.series.find((row) => row.listingId === listing.id)?.pattern
        .coveredDays,
    ).toBe(26);
    await scoped.query(
      "update canonical_product_listings set linked_at=$1::timestamptz where listing_id=$2::uuid",
      [evaluationTime.toISOString(), listing.id],
    );
    expect(
      (
        await evaluateCurrentShoppingList(db, list, "standard", evaluationTime)
      ).weekdayRecommendations[0]!.series.find((row) => row.listingId === listing.id)?.pattern
        .coveredDays,
    ).toBe(0);
  });
});
