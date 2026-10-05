import { randomUUID } from "node:crypto";
import { matchingVersion, shoppingListItemSchema } from "@comprafino/core";
import { z } from "zod";
import type { createDatabase } from "./client.ts";
import type { createTestQueryClient } from "./test-query-client.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import { evaluateCurrentShoppingItem } from "./shopping-list.ts";

/** Only called by the isolated-schema browser harness. Never production data. */
export async function seedShoppingListFixtures(
  db: ReturnType<typeof createDatabase>,
  client: ReturnType<typeof createTestQueryClient>,
) {
  const fixtures: Record<string, string> = {};
  const observedAt = new Date();
  for (const kind of ["preferred", "alternative"] as const) {
    const id = randomUUID();
    fixtures[kind] = id;
    const brand = kind === "preferred" ? "Bell's" : "Tottus";
    const title = `Huevos ${brand} Bandeja 30un`;
    await client.query(
      "insert into canonical_products(id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value) values($1,$2,$3,30,'unit',1,30)",
      [id, title, brand.toLowerCase()],
    );
    for (const [index, retailer] of (["metro", "plaza-vea", "tottus"] as const).entries()) {
      const listing = {
        retailer,
        externalId: `shopping-${kind}-${retailer}`,
        productId: `shopping-${kind}-${retailer}`,
        title,
        sourceBrand: brand,
        url:
          retailer === "tottus"
            ? "https://www.tottus.com.pe/tottus-pe/articulo/1/test"
            : retailer === "metro"
              ? "https://www.metro.pe/eggs/p"
              : "https://www.plazavea.com.pe/eggs/p",
        currentPriceCents:
          kind === "preferred"
            ? 1790 + index * 100
            : retailer === "tottus"
              ? 1490
              : 1590 + index * 100,
        currency: "PEN" as const,
        priceUnit: "UN" as const,
        observedAt,
        conditionalOffers:
          kind === "preferred" && retailer === "tottus"
            ? [
                {
                  conditionType: "payment_card" as const,
                  programKey: "cmr" as const,
                  conditionLabel: "Requiere tarjeta CMR" as const,
                  priceCents: 1290,
                  observedAt,
                },
              ]
            : [],
      };
      await persistListings(db, retailer, [listing]);
      const rows = z
        .array(z.object({ id: z.uuid() }))
        .parse(
          await client.query(
            "select id from retailer_listings where external_id=$1 and retailer_id=$2",
            [listing.externalId, retailer],
          ),
        );
      const listingId = rows[0]!.id;
      await persistCatalogNormalizations(db, [{ ...listing, id: listingId, retailerId: retailer }]);
      await client.query(
        "insert into canonical_product_listings(listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons) values($1,$2,$3,1,$4,'automatic',ARRAY['controlled shopping fixture'])",
        [listingId, id, retailer, matchingVersion],
      );
    }
  }
  const need = shoppingListItemSchema.parse({
    id: randomUUID(),
    intent: "generic",
    canonicalId: null,
    query: "huevos",
    label: "Huevos",
    quantity: { amount: 30, unit: "unit" },
    frequency: "weekly",
    createdAt: observedAt.toISOString(),
    updatedAt: observedAt.toISOString(),
  });
  if ((await evaluateCurrentShoppingItem(db, need, "standard")).best?.totalCostCents !== 1490)
    throw new Error("Shopping standard fixture failed");
  if ((await evaluateCurrentShoppingItem(db, need, "benefits")).best?.totalCostCents !== 1290)
    throw new Error("Shopping benefits fixture failed");
  return fixtures;
}
