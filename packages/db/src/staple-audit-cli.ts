import { catalogPolicy } from "@comprafino/core";
import { z } from "zod";
import { retailerIdSchema } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { searchPublicProducts } from "./generic-offers.ts";

// Read-only, fixed ten-query audit. Labels are reviewed separately, never inferred
// from the production classifier being evaluated.
const catalogAuditRow = z.object({
  id: z.uuid(),
  retailer_id: retailerIdSchema,
  external_id: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  package_text: z.string().nullable(),
  source_brand: z.string().nullable(),
  current_price_cents: z.number().int().nonnegative(),
  last_seen_at: z.coerce.date(),
  normalization_version: z.number().int().nullable(),
  input_fingerprint: z.string().nullable(),
});

const demandAuditRow = z.object({
  normalized_query: z.string(),
  request_count: z.number().int().nonnegative(),
  status: z.string(),
});

const historyAuditRow = z.object({
  states: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  digest: z
    .string()
    .regex(/^[a-f0-9]{32}$/u)
    .nullable(),
});

const queries = [
  "huevos",
  "arroz",
  "azúcar",
  "aceite",
  "fideos",
  "harina",
  "avena",
  "atún",
  "detergente",
  "papel higiénico",
];

try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) {
    throw new Error("No options supported");
  }

  const db = createDatabase();
  const now = new Date();
  const catalog =
    await db.execute(sql`select l.id,l.retailer_id,l.external_id,l.title,l.category,l.package_text,l.source_brand,l.current_price_cents,l.last_seen_at,
    n.normalization_version,n.input_fingerprint from retailer_listings l left join listing_normalizations n on n.listing_id=l.id order by l.retailer_id,l.title limit ${catalogPolicy.overflowSentinel}`);

  if (catalog.rows.length > catalogPolicy.retainedListingCap) {
    throw new Error("Catalog bound exceeded");
  }

  const demand = await db.execute(
    sql`select normalized_query,request_count,status from discovery_queries order by request_count desc,normalized_query limit 20`,
  );
  const history =
    await db.execute(sql`select count(*)::integer as states,count(*) filter(where valid_until is null)::integer as open,
    md5(string_agg(row(id,listing_id,current_price_cents,regular_price_cents,currency,price_unit,valid_from,valid_until)::text,'' order by id)) as digest from price_history`);
  const searches = [];

  for (const query of queries) {
    const result = await searchPublicProducts(db, query, "relevance", now);
    searches.push({
      query,
      canonicalGroups: result.products.map((p) => ({ id: p.id, title: p.displayName })),
      genericCount: result.offers.length,
      retailers: [...new Set(result.offers.map((o) => o.retailerId))],
      unitPriceCoverage: result.offers.filter((o) => o.unitPrice).length,
      offers: result.offers.map((o) => ({
        id: o.id,
        title: o.title,
        retailer: o.retailerId,
        sourceCategory: o.sourceCategory,
        family: o.family,
        priceCents: o.currentPriceCents,
        quantity: o.quantity,
        totalQuantity: o.totalQuantity,
        unitPrice: o.unitPrice,
        reason: o.unitPriceUnavailableReason,
      })),
    });
  }

  console.log(
    JSON.stringify(
      {
        observedAt: now.toISOString(),
        history: z.array(historyAuditRow).parse(history.rows),
        demand: z.array(demandAuditRow).parse(demand.rows),
        catalog: z.array(catalogAuditRow).parse(catalog.rows),
        searches,
      },
      (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
} catch {
  console.error(
    "Read-only staple audit failed. Check database configuration; no credentials logged.",
  );
  process.exitCode = 1;
}
