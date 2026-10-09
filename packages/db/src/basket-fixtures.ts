import { randomUUID } from "node:crypto";
import { z } from "zod";
import { matchingVersion, shoppingListSchema } from "@comprafino/core";
import type { RetailerId } from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import type { createTestQueryClient } from "./testing/test-query-client.ts";
import { evaluateCurrentShoppingList } from "./shopping-list.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";

/** Controlled exact milk products do not expand generic substitution coverage. */
export async function seedBasketFixtures(
  db: ReturnType<typeof createDatabase>,
  client: ReturnType<typeof createTestQueryClient>,
  count = 3,
) {
  const fixtures: Record<string, string> = {};
  const now = new Date();
  const retailers: RetailerId[] = ["metro", "plaza-vea", "tottus"];

  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    fixtures[`basket-${i}`] = id;
    const title = `Leche Basket ${String.fromCharCode(65 + i)} Entera Caja 1L`;
    await client.query(
      "insert into canonical_products(id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value) values($1,$2,'basket',1000,'ml',1,1000)",
      [id, title],
    );

    for (const [index, retailer] of retailers.entries()) {
      const listing = {
        retailer,
        externalId: `basket-${i}-${retailer}`,
        productId: `basket-${i}-${retailer}`,
        title,
        sourceBrand: "Basket",
        url: {
          tottus: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
          metro: "https://www.metro.pe/basket/p",
          makro: "https://www.makro.plazavea.com.pe/basket/p",
          "plaza-vea": "https://www.plazavea.com.pe/basket/p",
        }[retailer],
        currentPriceCents: index === i % 3 ? 1000 : 2500,
        currency: "PEN" as const,
        priceUnit: "UN" as const,
        observedAt: now,
      };
      await persistListings(db, retailer, [listing]);
      const row = z
        .array(z.object({ id: z.uuid() }))
        .parse(
          await client.query(
            "select id from retailer_listings where external_id=$1 and retailer_id=$2",
            [listing.externalId, retailer],
          ),
        )[0]!;
      await persistCatalogNormalizations(db, [{ ...listing, id: row.id, retailerId: retailer }]);
      await client.query(
        "insert into canonical_product_listings(listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons) values($1,$2,$3,1,$4,'automatic',ARRAY['controlled basket fixture'])",
        [row.id, id, retailer, matchingVersion],
      );
    }
  }

  if (count >= 3) {
    const list = shoppingListSchema.parse({
      version: 2,
      items: Object.values(fixtures)
        .slice(0, 3)
        .map((canonicalId) => ({
          id: randomUUID(),
          intent: "strict",
          canonicalId,
          label: "Leche fixture",
          query: "leche",
          quantityMode: "packages",
          quantity: { amount: 1, unit: "unit" },
          frequency: "weekly",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })),
    });
    const result = await evaluateCurrentShoppingList(db, list, "standard");

    if (result.baskets.map((b) => b.totalCostCents).join(",") !== "6000,4500,3000") {
      throw new Error("Basket fixture optima mismatch");
    }
  }

  return fixtures;
}

/** Browser fixture mutation is confined to the existing isolated-schema harness. */
export async function restrictBasketFixtureRetailers(restricted: boolean) {
  const { sql } = await import("drizzle-orm");
  const { fixtureDatabase: create } = await import("./testing/fixture-client.ts");

  if (!/^comprafino_e2e_[0-9a-f]{32}$/u.test(process.env.COMPRAFINO_E2E_SCHEMA ?? "")) {
    throw new Error("Basket fixture mutation requires an isolated E2E schema");
  }

  const db = create();
  const { closeLocalTestConnections } = await import("./testing/test-query-client.ts");

  try {
    await db.batch([
      db.execute(sql`update retailer_listings set available = ${
        restricted
          ? sql`case
    when external_id='basket-0-metro' or external_id='basket-1-plaza-vea' or external_id='basket-2-tottus' then true else false end`
          : sql`null`
      }
    where external_id like 'basket-%'`),
    ]);
  } finally {
    await closeLocalTestConnections();
  }
}
