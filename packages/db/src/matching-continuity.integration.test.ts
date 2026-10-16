import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  generateAutomaticCandidates,
  shoppingListSchema,
  weekdayEvidenceWindow,
} from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import { evaluatePairs, persistMatching, readMatchingSample } from "./matching.ts";
import { evaluateCurrentShoppingList } from "./shopping-list.ts";
import { getCanonicalProductComparison } from "./public-products.ts";
import { catalogTestContext, observation, publicNow } from "./testing/catalog-fixtures.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { shoppingWeekdayRows, weekdayRowsSchema } from "./weekday-recommendation.ts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("saved canonical identity continuity", () => {
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL: url ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, catalogRows } = harness;
  const title = "Leche Gloria Entera Caja 946ml";
  const hosts = {
    metro: "www.metro.pe",
    "plaza-vea": "www.plazavea.com.pe",
    tottus: "www.tottus.com.pe",
    makro: "www.makro.plazavea.com.pe",
  };

  async function add(
    retailer: NormalizedRetailerListing["retailer"],
    patch: Partial<NormalizedRetailerListing> = {},
  ) {
    const value = {
      ...observation(`continuity-${retailer}`, 0),
      retailer,
      title,
      sourceBrand: "Gloria",
      url: `https://${hosts[retailer]}/leche/p`,
      ...patch,
    };
    await persistListings(db, retailer, [value]);
    await persistCatalogNormalizations(db, await catalogRows(value.externalId));
  }

  async function match() {
    const rows = await readMatchingSample(db, 100);
    return persistMatching(db, rows, await evaluatePairs(db, generateAutomaticCandidates(rows)));
  }

  async function productIds() {
    return z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await query(
          "select distinct canonical_product_id as id from canonical_product_listings order by id",
        ),
      )
      .map((row) => row.id);
  }

  async function seed(retailers: NormalizedRetailerListing["retailer"][] = ["metro", "plaza-vea"]) {
    for (const retailer of retailers) {
      await add(retailer);
    }
    await match();
    return (await productIds())[0]!;
  }

  async function weekdayEvidence(id: string, now: Date) {
    const result = await db.execute(sql`with current_listings as (
      select l.id as listing_id,a.canonical_product_id as "canonicalId"
      from retailer_listings l
      left join canonical_product_listings a on a.listing_id=l.id
    )
      ${shoppingWeekdayRows([id], now)}`);
    return z.array(z.object({ coalesce: weekdayRowsSchema })).parse(result.rows)[0]!.coalesce;
  }

  function savedList(id: string, intent: "strict" | "preferred") {
    return shoppingListSchema.parse({
      version: 2,
      items: [
        {
          id: randomUUID(),
          label: "Mi leche",
          query: "leche gloria",
          intent,
          canonicalId: id,
          quantityMode: "packages",
          quantity: { amount: 1, unit: "unit" },
          frequency: "weekly",
          createdAt: publicNow.toISOString(),
          updatedAt: publicNow.toISOString(),
        },
      ],
    });
  }

  beforeAll(() => harness.setup(), 30_000);
  beforeEach(() => harness.reset(), 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("keeps strict and preferred saved products and their public URL when a third retailer joins", async () => {
    await add("metro");
    await add("plaza-vea");
    await match();
    const [id] = await productIds();
    const lists = [savedList(id!, "strict"), savedList(id!, "preferred")];
    const serialized = lists.map((list) => JSON.stringify(list));
    for (const list of lists) {
      const userId = randomUUID();
      await query("insert into \"user\"(id,name,email) values($1,'Continuity test',$2)", [
        userId,
        `${userId}@example.test`,
      ]);
      await query("insert into user_shopping_lists(user_id,revision,data) values($1,7,$2::jsonb)", [
        userId,
        JSON.stringify(list),
      ]);
    }
    const cloudDocuments = await query("select * from user_shopping_lists order by user_id");
    for (const list of lists) {
      const before = await evaluateCurrentShoppingList(db, list, "standard", publicNow);
      expect(before.baskets[0]?.status).toBe("complete");
    }
    const history = await query("select * from price_history order by listing_id,valid_from");
    const associations = await query(
      "select * from canonical_product_listings order by listing_id",
    );
    await add("tottus", { currentPriceCents: 1190 });
    await match();

    expect(await productIds()).toEqual([id]);
    expect((await getCanonicalProductComparison(db, id!, publicNow))?.id).toBe(id);
    for (const list of lists) {
      const after = await evaluateCurrentShoppingList(db, list, "standard", publicNow);
      expect(after.baskets[0]?.status).toBe("complete");
      expect(after.baskets[0]?.totalCostCents).toBe(1190);
    }
    expect(lists.map((list) => JSON.stringify(list))).toEqual(serialized);
    expect(await query("select * from user_shopping_lists order by user_id")).toEqual(
      cloudDocuments,
    );
    expect(await query("select * from price_history order by listing_id,valid_from")).toEqual(
      expect.arrayContaining(history),
    );
    expect(await query("select * from canonical_product_listings order by listing_id")).toEqual(
      expect.arrayContaining(associations),
    );
  });

  it("adopts a valid legacy ID without rewriting saved data", async () => {
    const original = await seed();
    const id = "22222222-2222-8222-8222-222222222222";
    await query(
      `insert into canonical_products(id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value)
      select $1::uuid,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value from canonical_products where id=$2::uuid`,
      [id, original],
    );
    await query("update canonical_product_listings set canonical_product_id=$1::uuid", [id]);
    await query("delete from canonical_products where id=$1::uuid", [original]);
    await add("tottus");
    await match();
    expect(await productIds()).toEqual([id]);
    expect(await query("select identity_key from canonical_products")).toEqual([
      { identity_key: expect.any(String) },
    ]);
  });

  it("does not bootstrap revoked legacy identity from current titles", async () => {
    const id = await seed();
    await query("update canonical_products set identity_key=null");
    for (const retailer of ["metro", "plaza-vea", "tottus"] as const) {
      await add(retailer, {
        title: "Leche Gloria Descremada Caja 946ml",
        observedAt: observation("", 1).observedAt,
      });
    }
    await match();
    expect(await productIds()).not.toContain(id);
    expect(await getCanonicalProductComparison(db, id, publicNow)).toBeNull();
  });

  it.each([
    "Leche Gloria Descremada Caja 946ml",
    "Leche Gloria Entera Botella 946ml",
    "Leche Gloria Entera Caja 750ml",
    "Leche Gloria Entera Pack x2 Cajas 946ml",
  ])("does not point an existing list at changed identity: %s", async (changedTitle) => {
    const id = await seed();
    const lists = [savedList(id, "strict"), savedList(id, "preferred")];
    for (const retailer of ["metro", "plaza-vea"] as const) {
      await add(retailer, { title: changedTitle, observedAt: observation("", 1).observedAt });
    }
    await match();
    expect(await productIds()).not.toContain(id);
    for (const list of lists) {
      expect(
        (await evaluateCurrentShoppingList(db, list, "standard", publicNow)).baskets[0]?.status,
      ).toBe("incomplete");
    }
  });

  it("keeps an unambiguous contraction and re-expansion with two unchanged anchors", async () => {
    const id = await seed(["metro", "plaza-vea", "tottus"]);
    await add("tottus", {
      title: "Leche Gloria Descremada Caja 946ml",
      observedAt: observation("", 1).observedAt,
    });
    await match();
    expect(await productIds()).toEqual([id]);
    expect(
      await query("select retailer_id from canonical_product_listings order by retailer_id"),
    ).toEqual([{ retailer_id: "metro" }, { retailer_id: "plaza-vea" }]);
    await add("tottus", { observedAt: observation("", 2).observedAt });
    await match();
    expect(await productIds()).toEqual([id]);
  });

  it("does not choose a successor when one group splits into two valid products", async () => {
    const id = await seed(["metro", "plaza-vea", "tottus", "makro"]);
    for (const retailer of ["tottus", "makro"] as const) {
      await add(retailer, {
        title: "Leche Gloria Descremada Caja 946ml",
        observedAt: observation("", 1).observedAt,
      });
    }
    await match();
    const ids = await productIds();
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(id);
    expect(await getCanonicalProductComparison(db, id, publicNow)).toBeNull();
  });

  it("does not resurrect an old membership-derived ID after expansion and a later split", async () => {
    const id = await seed();
    await add("tottus");
    await add("makro");
    await match();
    expect(await productIds()).toEqual([id]);
    for (const retailer of ["tottus", "makro"] as const) {
      await add(retailer, {
        title: "Leche Gloria Descremada Caja 946ml",
        observedAt: observation("", 1).observedAt,
      });
    }
    await match();
    expect(await productIds()).toHaveLength(2);
    expect(await productIds()).not.toContain(id);
    expect(await getCanonicalProductComparison(db, id, publicNow)).toBeNull();
  });

  it("does not choose one of two predecessors during a merge", async () => {
    const first = await seed();
    await add("tottus");
    await add("makro");
    const secondRows = (await readMatchingSample(db, 100)).filter(
      (row) => row.retailer === "tottus" || row.retailer === "makro",
    );
    await persistMatching(
      db,
      secondRows,
      await evaluatePairs(db, generateAutomaticCandidates(secondRows)),
    );
    const oldIds = await productIds();
    expect(oldIds).toHaveLength(2);
    expect(oldIds).toContain(first);
    await match();
    const ids = await productIds();
    expect(ids).toHaveLength(1);
    expect(oldIds).not.toContain(ids[0]);
    for (const id of oldIds) {
      expect(await getCanonicalProductComparison(db, id, publicNow)).toBeNull();
    }
  });

  it("serializes expansions and leaves replayed writes idempotent", async () => {
    const id = await seed();
    await add("tottus");
    const rows = await readMatchingSample(db, 100);
    const pairs = await evaluatePairs(db, generateAutomaticCandidates(rows));
    const writes = await Promise.all([
      persistMatching(db, rows, pairs),
      persistMatching(db, rows, pairs),
    ]);
    expect(writes.every((write) => !write.stale)).toBe(true);
    expect(writes.reduce((sum, write) => sum + write.linksCreated, 0)).toBe(1);
    expect(await productIds()).toEqual([id]);
    expect(await persistMatching(db, rows, pairs)).toEqual({
      productsCreated: 0,
      productsUpdated: 0,
      productsRemoved: 0,
      linksCreated: 0,
      linksUpdated: 0,
      linksRemoved: 0,
      stale: false,
    });
  });

  it("rejects a stale expansion and preserves manual decisions", async () => {
    await seed();
    await add("tottus");
    const rows = await readMatchingSample(db, 100);
    const pairs = await evaluatePairs(db, generateAutomaticCandidates(rows));
    await add("tottus", {
      title: "Leche Gloria Light Caja 946ml",
      observedAt: observation("", 1).observedAt,
    });
    const before = await query("select * from canonical_product_listings order by listing_id");
    expect(await persistMatching(db, rows, pairs)).toMatchObject({ stale: true });
    expect(await query("select * from canonical_product_listings order by listing_id")).toEqual(
      before,
    );
    await query("update canonical_product_listings set method='manual'");
    const manual = await query("select * from canonical_product_listings order by listing_id");
    expect(await match()).toMatchObject({ stale: true });
    expect(await query("select * from canonical_product_listings order by listing_id")).toEqual(
      manual,
    );
  });

  it("refuses a concurrently expanded partial scope and succeeds after a complete retry", async () => {
    const id = await seed();
    await add("tottus");
    await add("makro");
    const all = await readMatchingSample(db, 100);
    const left = all.filter((row) => row.retailer !== "makro");
    const right = all.filter((row) => row.retailer !== "tottus");
    const leftPairs = await evaluatePairs(db, generateAutomaticCandidates(left));
    const rightPairs = await evaluatePairs(db, generateAutomaticCandidates(right));
    const results = await Promise.all([
      persistMatching(db, left, leftPairs),
      persistMatching(db, right, rightPairs),
    ]);
    expect(results.filter((result) => result.stale)).toHaveLength(1);
    expect(await productIds()).toEqual([id]);
    await match();
    expect(await productIds()).toEqual([id]);
    expect(await query("select listing_id from canonical_product_listings")).toHaveLength(4);
  });

  it("preserves tri-state availability and excludes zero ordinary prices after expansion", async () => {
    await add("metro", { available: true });
    await add("plaza-vea", { available: false });
    await match();
    const [id] = await productIds();
    await expect(add("tottus", { currentPriceCents: 0 })).rejects.toThrow(
      "Ordinary payable price must be positive",
    );
    await add("tottus");
    // Simulate a historical zero placeholder; current writers reject these.
    await query(
      "update price_history set current_price_cents=0 where listing_id in (select id from retailer_listings where retailer_id='tottus')",
    );
    await query("update retailer_listings set current_price_cents=0 where retailer_id='tottus'");
    await match();
    expect(await productIds()).toEqual([id]);
    const product = await getCanonicalProductComparison(db, id!, publicNow);
    expect(product?.offers).toHaveLength(2);
    expect(product?.lowestPriceCents).toBe(1290);
    expect(
      await query("select retailer_id,available from retailer_listings order by retailer_id"),
    ).toEqual([
      { retailer_id: "metro", available: true },
      { retailer_id: "plaza-vea", available: false },
      { retailer_id: "tottus", available: null },
    ]);
  });

  it("preserves history cutoffs for existing members without backdating new or revalidated links", async () => {
    const now = new Date();
    const observedAt = new Date(`${weekdayEvidenceWindow(now).end}T12:00:00Z`);
    await add("metro", { observedAt });
    await add("plaza-vea", { observedAt });
    await match();
    const [id] = await productIds();
    await query("update canonical_product_listings set linked_at=$1::timestamptz", [
      observedAt.toISOString(),
    ]);
    const before = await weekdayEvidence(id!, now);
    expect(before).toHaveLength(2);
    await add("tottus", { observedAt });
    await match();
    expect(await weekdayEvidence(id!, now)).toEqual(expect.arrayContaining(before));
    expect(await weekdayEvidence(id!, now)).toHaveLength(2);
    await add("metro", {
      title: "Gloria Leche Entera Caja 946ml",
      observedAt: new Date(observedAt.getTime() + 60_000),
    });
    await match();
    expect(await productIds()).toEqual([id]);
    expect(await weekdayEvidence(id!, now)).toHaveLength(1);
  });
});
