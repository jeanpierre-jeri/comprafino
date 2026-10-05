import { randomUUID } from "node:crypto";
import { z } from "zod";

import { normalizeCatalogListing } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";

import { catalogRecordSchema, persistCatalogNormalizations } from "../catalog.ts";

import { evaluatePairs, persistMatching } from "../matching.ts";
import type { MatchingSnapshot } from "../matching.ts";
import type { Acquisition } from "../ingestion.ts";
import { persistListings } from "../ingestion.ts";
import {
  getCanonicalProductComparison as queryComparison,
  searchCanonicalProducts as querySearch,
} from "../public-products.ts";

import { ownedTestDatabase } from "./database.ts";
const publicNow = new Date("2026-10-03T09:10:00Z");
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

export function catalogTestContext(env: Record<string, string | undefined> = process.env) {
  const harness = ownedTestDatabase(env);
  const { db } = harness;
  const query = (text: string, params: string[] = []) => harness.scoped.query(text, params);
  const getCanonicalProductComparison = (...args: Parameters<typeof queryComparison>) =>
    queryComparison(args[0], args[1], publicNow);
  const searchCanonicalProducts = (...args: Parameters<typeof querySearch>) =>
    querySearch(args[0], args[1], publicNow);
  async function states(externalId: string) {
    return stateSchema.parse(
      await query(
        `select h.current_price_cents, h.regular_price_cents, h.valid_from, h.valid_until
      from price_history h join retailer_listings l on l.id=h.listing_id where l.external_id=$1 order by h.valid_from`,
        [externalId],
      ),
    );
  }
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
  async function cleanupIdentity(prefix: string) {
    await query(
      "delete from canonical_products where id in (select a.canonical_product_id from canonical_product_listings a join retailer_listings l on l.id=a.listing_id where l.external_id in ($1,$2))",
      [`${prefix}-metro`, `${prefix}-plaza-vea`],
    );
  }
  async function seedGeneric(title: string, cents: number, priceUnit: "UN" | "KG" = "UN") {
    const value = { ...observation(`generic-${randomUUID()}`, 0, cents), title, priceUnit };
    await persistListings(db, "tottus", [value]);
    await persistCatalogNormalizations(db, await catalogRows(value.externalId));
    return (await catalogRows(value.externalId))[0]!;
  }
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
  async function resetDiscovery() {
    await query("delete from discovery_queries");
    await query("delete from discovery_daily_budget");
  }
  async function coverageDays(externalId: string) {
    return z
      .array(
        z.object({
          observation_date: z.string(),
          first_observed_at: z.coerce.date(),
          last_observed_at: z.coerce.date(),
          observation_count: z.number().int(),
        }),
      )
      .parse(
        await query(
          `select d.* from listing_observation_days d join retailer_listings l on l.id=d.listing_id
       where l.external_id=$1 order by observation_date`,
          [externalId],
        ),
      );
  }
  return {
    ...harness,
    query,
    states,
    catalogRows,
    matchingRows,
    seedMatch,
    cleanupIdentity,
    seedGeneric,
    seedPublicProduct,
    resetDiscovery,
    coverageDays,
    getCanonicalProductComparison,
    searchCanonicalProducts,
  };
}
export { observation, publicNow };
