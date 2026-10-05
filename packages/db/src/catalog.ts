import { createHash } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  calculateUnitPrice,
  classifyProductFamily,
  catalogInputSchema,
  normalizeCatalogListing,
  normalizationVersion,
  retailerIdSchema,
} from "@comprafino/core";
import type { CatalogInput, RetailerId } from "@comprafino/core";
import { z } from "zod";
import { createDatabase } from "./client.ts";
import { listingNormalizations, retailerListings, priceHistory } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>;
export const catalogRecordSchema = catalogInputSchema
  .omit({ sourceQuantity: true, sourcePackageCount: true })
  .extend({
    id: z.uuid(),
    retailerId: retailerIdSchema,
  });
export type CatalogRecord = z.infer<typeof catalogRecordSchema>;
export function catalogFingerprint(input: CatalogInput): string {
  const value = catalogInputSchema.parse(input);
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: value.title,
        priceUnit: value.priceUnit,
        packageText: value.packageText ?? null,
        sourceBrand: value.sourceBrand ?? null,
        sourceUnitMultiplier: value.sourceUnitMultiplier ?? null,
      }),
    )
    .digest("hex");
}
export function catalogRecord(row: typeof retailerListings.$inferSelect): CatalogRecord {
  return catalogRecordSchema.parse({
    ...row,
    sourceUnitMultiplier:
      row.sourceUnitMultiplier === null ? null : Number(row.sourceUnitMultiplier),
  });
}
export function catalogPersistenceStatements(raw: readonly CatalogRecord[]) {
  const records = raw.map((row) => catalogRecordSchema.parse(row));
  if (!records.length) throw new Error("Empty catalog batch");
  if (new Set(records.map((row) => row.id)).size !== records.length)
    throw new Error("Duplicate catalog listing");
  const payload = JSON.stringify(
    records.map((row) => {
      const a = normalizeCatalogListing(row);
      return {
        id: row.id,
        retailer_id: row.retailerId,
        title: row.title,
        price_unit: row.priceUnit,
        package_text: row.packageText ?? null,
        source_brand: row.sourceBrand ?? null,
        source_unit_multiplier: row.sourceUnitMultiplier ?? null,
        input_fingerprint: catalogFingerprint(row),
        normalization_version: a.normalizationVersion,
        normalized_title: a.normalizedTitle,
        brand: a.brand,
        brand_key: a.brandKey,
        brand_source: a.brandSource,
        quantity_value: a.quantity?.value ?? null,
        quantity_unit: a.quantity?.unit ?? null,
        package_count: a.packageCount,
        total_quantity_value: a.totalQuantity?.value ?? null,
        total_quantity_unit: a.totalQuantity?.unit ?? null,
        pricing_basis: a.pricingBasis,
        sold_by_weight: a.soldByWeight,
        issues: a.issues,
      };
    }),
  );
  const eligible = sql`select x.* from jsonb_to_recordset(${payload}::jsonb) as x(
    id uuid, retailer_id text, title text, price_unit text, package_text text, source_brand text, source_unit_multiplier numeric,
    input_fingerprint text, normalization_version integer, normalized_title text, brand text, brand_key text,
    brand_source text, quantity_value integer, quantity_unit text, package_count integer,
    total_quantity_value integer, total_quantity_unit text, pricing_basis text, sold_by_weight boolean, issues text[])
    join retailer_listings l on l.id = x.id
    where l.retailer_id = x.retailer_id and (l.title, l.price_unit, l.package_text, l.source_brand, l.source_unit_multiplier)
      is not distinct from (x.title, x.price_unit, x.package_text, x.source_brand, x.source_unit_multiplier)`;
  const retailers = JSON.stringify([...new Set(records.map((row) => row.retailerId))]);
  return [
    // Same locks as ingestion, in a stable order, so stale reads never overwrite current metadata.
    sql`select id from retailers where id in (select jsonb_array_elements_text(${retailers}::jsonb)) order by id for update`,
    sql`select count(*)::integer as eligible from (${eligible}) e`,
    sql`with normalized as (insert into listing_normalizations (listing_id, input_fingerprint, normalization_version,
      normalized_title, brand, brand_key, brand_source, quantity_value, quantity_unit, package_count,
      total_quantity_value, total_quantity_unit, pricing_basis, sold_by_weight, issues)
      select id, input_fingerprint, normalization_version, normalized_title, brand, brand_key, brand_source,
        quantity_value, quantity_unit, package_count, total_quantity_value, total_quantity_unit,
        pricing_basis, sold_by_weight, issues from (${eligible}) e
      on conflict (listing_id) do update set
        input_fingerprint = excluded.input_fingerprint, normalization_version = excluded.normalization_version,
        normalized_title = excluded.normalized_title, brand = excluded.brand, brand_key = excluded.brand_key,
        brand_source = excluded.brand_source, quantity_value = excluded.quantity_value, quantity_unit = excluded.quantity_unit,
        package_count = excluded.package_count, total_quantity_value = excluded.total_quantity_value,
        total_quantity_unit = excluded.total_quantity_unit, pricing_basis = excluded.pricing_basis,
        sold_by_weight = excluded.sold_by_weight, issues = excluded.issues, normalized_at = now()
      where (listing_normalizations.input_fingerprint, listing_normalizations.normalization_version,
        listing_normalizations.normalized_title, listing_normalizations.brand, listing_normalizations.brand_key,
        listing_normalizations.brand_source, listing_normalizations.quantity_value, listing_normalizations.quantity_unit,
        listing_normalizations.package_count, listing_normalizations.total_quantity_value, listing_normalizations.total_quantity_unit,
        listing_normalizations.pricing_basis, listing_normalizations.sold_by_weight, listing_normalizations.issues)
        is distinct from (excluded.input_fingerprint, excluded.normalization_version, excluded.normalized_title,
        excluded.brand, excluded.brand_key, excluded.brand_source, excluded.quantity_value, excluded.quantity_unit,
        excluded.package_count, excluded.total_quantity_value, excluded.total_quantity_unit, excluded.pricing_basis,
        excluded.sold_by_weight, excluded.issues) returning listing_id),
      invalidated as (
        -- Changed derived evidence also requires matching again. Unchanged reruns
        -- return no rows and cannot revoke an already validated association.
        update canonical_product_listings a set confidence=0 from normalized n
        where a.listing_id=n.listing_id and a.method='automatic'
      ) select listing_id from normalized`,
  ] as const;
}
export async function persistCatalogNormalizations(db: Database, rows: readonly CatalogRecord[]) {
  if (!rows.length) return { changed: 0, unchanged: 0, stale: 0 };
  const statements = catalogPersistenceStatements(rows);
  const results = await db.batch([
    db.execute(statements[0]),
    db.execute(statements[1]),
    db.execute(statements[2]),
  ]);
  const [{ eligible }] = z
    .tuple([z.object({ eligible: z.number().int().nonnegative() })])
    .parse(results[1].rows);
  const changed = results[2].rows.length;
  return { changed, unchanged: eligible - changed, stale: rows.length - eligible };
}
export async function readCatalogSample(db: Database, limit: number, retailer?: RetailerId) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
    throw new Error("Limit must be an integer from 1 to 5000");
  const rows = await db
    .select()
    .from(retailerListings)
    .where(retailer ? eq(retailerListings.retailerId, retailer) : undefined)
    .orderBy(asc(retailerListings.retailerId), asc(retailerListings.externalId))
    .limit(limit);
  return rows.map(catalogRecord);
}
export async function normalizeCatalog(
  db: Database,
  limit: number,
  retailer?: RetailerId,
  dryRun = false,
) {
  const rows = await readCatalogSample(db, limit, retailer);
  const samples = rows.map((input) => ({ input, attributes: normalizeCatalogListing(input) }));
  const persisted = dryRun ? null : await persistCatalogNormalizations(db, rows);
  const coverage = {
    processed: samples.length,
    brand: samples.filter((s) => s.attributes.brand !== null).length,
    measurableQuantity: samples.filter(
      (s) => s.attributes.quantity && s.attributes.quantity.unit !== "unit",
    ).length,
    countQuantity: samples.filter((s) => s.attributes.quantity?.unit === "unit").length,
    packageCount: samples.filter((s) => s.attributes.packageCount !== null).length,
    soldByWeight: samples.filter((s) => s.attributes.soldByWeight).length,
    withIssues: samples.filter((s) => s.attributes.issues.length).length,
    unresolved: samples.filter(
      (s) =>
        !s.attributes.brand ||
        (!s.attributes.soldByWeight && (!s.attributes.quantity || !s.attributes.packageCount)) ||
        s.attributes.issues.length,
    ).length,
  };
  return { persisted, coverage, samples };
}
export async function inspectCatalog(db = createDatabase()) {
  // Bound inspection independently per retailer so one store cannot hide the others.
  const groups = await Promise.all(
    retailerIdSchema.options.map((retailer) =>
      db
        .select({
          listing: retailerListings,
          normalization: listingNormalizations,
          price: priceHistory,
        })
        .from(retailerListings)
        .leftJoin(listingNormalizations, eq(retailerListings.id, listingNormalizations.listingId))
        .leftJoin(
          priceHistory,
          and(eq(retailerListings.id, priceHistory.listingId), isNull(priceHistory.validUntil)),
        )
        .where(eq(retailerListings.retailerId, retailer))
        .orderBy(asc(retailerListings.externalId))
        .limit(20),
    ),
  );
  return groups.flat().map((row) => ({
    ...row,
    family: classifyProductFamily({
      title: row.listing.title,
      retailerId: retailerIdSchema.parse(row.listing.retailerId),
      sourceCategory: row.listing.category,
    }),
    unitPriceCalculation:
      row.price &&
      row.normalization &&
      row.normalization.inputFingerprint === catalogFingerprint(catalogRecord(row.listing)) &&
      row.normalization.normalizationVersion === normalizationVersion
        ? calculateUnitPrice({
            ...normalizeCatalogListing(catalogRecord(row.listing)),
            title: row.listing.title,
            productFamily: classifyProductFamily({
              title: row.listing.title,
              retailerId: retailerIdSchema.parse(row.listing.retailerId),
              sourceCategory: row.listing.category,
            }).family,
            currentPriceCents: row.price.currentPriceCents,
            observedAt: row.listing.lastSeenAt,
            available: row.listing.available,
          })
        : null,
    stale: row.normalization
      ? row.normalization.inputFingerprint !== catalogFingerprint(catalogRecord(row.listing)) ||
        row.normalization.normalizationVersion !== normalizationVersion
      : false,
  }));
}
