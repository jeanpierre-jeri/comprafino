import { catalogPolicy, generateCandidates } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import { z } from "zod";
import type { createDatabase } from "../client.ts";
import type { createTestQueryClient } from "./test-query-client.ts";
import { persistListings } from "../ingestion.ts";
import { persistCatalogNormalizations } from "../catalog.ts";
import { evaluatePairs, persistMatching, readMatchingSample } from "../matching.ts";
import { searchPublicProducts } from "../generic-offers.ts";

/** Only the owned-schema browser harness calls this; no source requests. */
export async function seedSearchExperienceFixtures(
  db: ReturnType<typeof createDatabase>,
  client: ReturnType<typeof createTestQueryClient>,
) {
  const now = new Date();
  const fixtures: Record<string, string> = {};
  const exactIds = new Set<string>();

  for (const retailer of ["metro", "tottus", "plaza-vea", "makro"] as const) {
    const value: NormalizedRetailerListing = {
      retailer,
      externalId: `search-experience-${retailer}`,
      productId: `search-experience-${retailer}`,
      title: "Huevos Pardos Auditexperiencia Bandeja 30un",
      sourceBrand: "Auditexperiencia",
      url: {
        metro: "https://www.metro.pe/eggs/p",
        tottus: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
        "plaza-vea": "https://www.plazavea.com.pe/eggs/p",
        makro: "https://www.makro.plazavea.com.pe/eggs/p",
      }[retailer],
      currency: "PEN",
      priceUnit: "UN",
      currentPriceCents: retailer === "plaza-vea" || retailer === "makro" ? 1000 : 6000,
      available: retailer === "plaza-vea" ? false : undefined,
      observedAt: new Date(now.getTime() - (retailer === "makro" ? 40 * 3_600_000 : 60_000)),
      conditionalOffers:
        retailer === "tottus"
          ? [
              {
                programKey: "cmr",
                conditionType: "payment_card",
                conditionLabel: "Requiere tarjeta CMR",
                priceCents: 5400,
                observedAt: new Date(now.getTime() - 60_000),
              },
            ]
          : [],
    };
    await persistListings(db, retailer, [value]);
    const [row] = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await client.query(
          "select id from retailer_listings where retailer_id=$1 and external_id=$2",
          [retailer, value.externalId],
        ),
      );
    if (!row) {
      throw new Error("Missing search experience listing");
    }
    exactIds.add(row.id);
    fixtures[`search-${retailer}`] = row.id;
    await persistCatalogNormalizations(db, [{ ...value, id: row.id, retailerId: retailer }]);
  }

  const rows = (await readMatchingSample(db, catalogPolicy.retainedListingCap)).filter((row) =>
    exactIds.has(row.id),
  );
  await persistMatching(db, rows, await evaluatePairs(db, generateCandidates(rows)));

  for (const [kind, title, priceCents] of [
    ["15", "Huevos Blancos Auditexperiencia Bandeja 15un", 4500],
    ["missing", "Huevos Pardos Auditexperiencia Bandeja", 7000],
    ["ambiguous", "Huevos Pardos Auditexperiencia Pack 3 x 15 unidades", 8000],
  ] as const) {
    const value: NormalizedRetailerListing = {
      retailer: "metro",
      externalId: `search-experience-${kind}`,
      productId: `search-experience-${kind}`,
      title,
      sourceBrand: "Auditexperiencia",
      url: "https://www.metro.pe/eggs/p",
      currency: "PEN",
      priceUnit: "UN",
      currentPriceCents: priceCents,
      observedAt: new Date(now.getTime() - 60_000),
    };
    await persistListings(db, "metro", [value]);
    const [row] = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await client.query(
          "select id from retailer_listings where retailer_id='metro' and external_id=$1",
          [value.externalId],
        ),
      );
    if (!row) {
      throw new Error("Missing generic search experience listing");
    }
    fixtures[`search-${kind}`] = row.id;
    await persistCatalogNormalizations(db, [{ ...value, id: row.id, retailerId: "metro" }]);
  }

  const results = await searchPublicProducts(db, "huevos auditexperiencia", "unit-price", now);
  const product = results.products[0];
  if (
    results.products.length !== 1 ||
    product?.retailerCount !== 4 ||
    product.currentOfferCount !== 2 ||
    results.offers.length !== 5
  ) {
    throw new Error("Search experience fixture eligibility mismatch");
  }
  fixtures["search-product"] = product.id;
  return fixtures;
}
