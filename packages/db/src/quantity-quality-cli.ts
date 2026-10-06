import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  calculateUnitPrice,
  classifyProductFamily,
  normalizeCatalogListing,
  normalizationVersion,
  formatUnitPrice,
} from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { catalogRecordSchema, catalogFingerprint } from "./catalog.ts";

try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) {
    throw new Error("No options supported");
  }

  const db = createDatabase();
  const now = new Date();
  const result = await db.execute(
    sql`select jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,'priceUnit',l.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,l.category,n.normalization_version as version,n.input_fingerprint as fingerprint,l.available,l.last_seen_at as "observedAt",h.current_price_cents as "priceCents" from retailer_listings l left join listing_normalizations n on n.listing_id=l.id left join price_history h on h.listing_id=l.id and h.valid_until is null where l.active order by l.retailer_id,l.title limit ${catalogPolicy.overflowSentinel}`,
  );

  if (result.rows.length > catalogPolicy.retainedListingCap) {
    throw new Error("Catalog bound exceeded");
  }

  const rows = z
    .array(
      z.object({
        listing: catalogRecordSchema,
        category: z.string().nullable(),
        version: z.number().int().nullable(),
        fingerprint: z.string().nullable(),
        available: z.boolean().nullable(),
        observedAt: z.coerce.date(),
        priceCents: z.number().int().nullable(),
      }),
    )
    .parse(result.rows)
    .map((row) => {
      const attrs = normalizeCatalogListing(row.listing);
      const family = classifyProductFamily({
        title: row.listing.title,
        retailerId: row.listing.retailerId,
        sourceCategory: row.category,
      }).family;
      const calc = calculateUnitPrice(
        {
          ...attrs,
          title: row.listing.title,
          productFamily: family,
          currentPriceCents: row.priceCents ?? -1,
          available: row.available,
          observedAt: row.observedAt,
        },
        now,
      );
      const reason =
        row.version !== normalizationVersion || row.fingerprint !== catalogFingerprint(row.listing)
          ? "stale-normalization"
          : calc.reason;

      return {
        retailer: row.listing.retailerId,
        title: row.listing.title,
        packageText: row.listing.packageText ?? null,
        family,
        quantity: attrs.totalQuantity,
        quality: reason ? "withheld" : calc.price!.quality,
        basis: reason ? null : calc.price!.basis,
        display: reason ? null : formatUnitPrice(calc.price!),
        reason,
      };
    });
  const summarize = (sample: typeof rows) => ({
    offers: sample.length,
    strong: sample.filter((r) => r.quality === "strong").length,
    approximate: sample.filter((r) => r.quality === "approximate").length,
    withheld: sample.filter((r) => r.quality === "withheld").length,
    reasons: Object.fromEntries(
      [...new Set(sample.flatMap((r) => (r.reason ? [r.reason] : [])))].map((reason) => [
        reason,
        sample.filter((r) => r.reason === reason).length,
      ]),
    ),
  });
  console.log(
    JSON.stringify(
      {
        observedAt: now.toISOString(),
        total: summarize(rows),
        retailers: ["tottus", "plaza-vea", "metro"].map((retailer) => ({
          retailer,
          ...summarize(rows.filter((r) => r.retailer === retailer)),
        })),
        families: [
          "canned_tuna",
          "toilet_paper",
          "detergent",
          "eggs",
          "rice",
          "cooking_oil",
          "sugar",
        ].map((family) => {
          const sample = rows.filter((r) => r.family === family);

          return {
            family,
            ...summarize(sample),
            examples: sample.slice(0, 6),
            retailers: ["tottus", "plaza-vea", "metro"].map((retailer) => ({
              retailer,
              ...summarize(sample.filter((r) => r.retailer === retailer)),
            })),
          };
        }),
        offers: rows,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Read-only quantity-quality audit failed. Check database configuration and migrations; no credentials logged.",
  );
  process.exitCode = 1;
}
