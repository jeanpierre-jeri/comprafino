import {
  catalogPolicy,
  evaluateCatalogHealth,
  listingRefreshPolicy,
  retailerIdSchema,
} from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client.ts";
import { inspectOperations } from "./operations.ts";
import { genericProductOffer } from "./generic-offers.ts";
import { readHealthStep } from "./catalog-health-read.ts";
import type { ReportProgress } from "../../../scripts/cli-progress.ts";

/** Count ordinary searchable offers in bounded pages, without constructing the full audit. */
async function inspectHealthCounts(
  db: ReturnType<typeof createDatabase>,
  now: Date,
  progress?: ReportProgress,
) {
  progress?.("Salud: contando registros retenidos");
  const known = await readHealthStep(
    "counts",
    () =>
      db.execute(sql`select retailer_id as retailer,count(*)::int as known
    from retailer_listings group by retailer_id`),
    progress,
  );
  const retailers = Object.fromEntries(
    retailerIdSchema.options.map((retailer) => [retailer, { known: 0, publicGeneric: 0 }]),
  );
  const counts = z
    .array(z.object({ retailer: retailerIdSchema, known: z.number().int().nonnegative() }))
    .parse(known.rows);
  let retainedListings = 0;
  for (const row of counts) {
    retailers[row.retailer]!.known = row.known;
    retainedListings += row.known;
  }
  if (retainedListings > catalogPolicy.retainedListingCap) {
    throw new Error("Catalog audit exceeds retained capacity");
  }
  const freshSince = new Date(now.getTime() - listingRefreshPolicy.freshHours * 60 * 60 * 1000);
  let cursor: string | null = null;
  let inspected = 0;
  while (true) {
    progress?.(
      "Salud: candidatos de búsqueda revisados",
      inspected,
      undefined,
      `${retainedListings} registros retenidos`,
    );
    // Canonical groups, images and conditional benefits cannot change ordinary
    // generic admission. Reuse its authoritative fingerprint, URL and price validator.
    const page: { rows: Record<string, unknown>[] } = await readHealthStep(
      "offers_page",
      () =>
        db.execute(sql`select jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,
      'priceUnit',h.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,
      'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,
      l.category as "sourceCategory",r.name as "retailerName",l.url,
      h.current_price_cents as "currentPriceCents",h.regular_price_cents as "regularPriceCents",
      l.last_seen_at as "observedAt",l.available,
      n.input_fingerprint as fingerprint,n.normalization_version as version
      from retailer_listings l join retailers r on r.id=l.retailer_id
      join listing_normalizations n on n.listing_id=l.id
      join price_history h on h.listing_id=l.id and h.valid_until is null
      where l.active and l.available is distinct from false and h.currency='PEN' and h.current_price_cents>0
        and h.price_unit=l.price_unit and h.price_unit in ('UN','KG')
        and l.last_seen_at between ${freshSince.toISOString()}::timestamptz and ${now.toISOString()}::timestamptz
        and ${cursor ? sql`l.id>${cursor}::uuid` : sql`true`}
      order by l.id limit ${catalogPolicy.batchSize}`),
      progress,
    );
    inspected += page.rows.length;
    if (inspected > catalogPolicy.retainedListingCap) {
      throw new Error("Catalog audit exceeds retained capacity");
    }
    for (const row of page.rows) {
      // These were SQL literals, never source evidence. Reconstruct exactly the
      // same boundary input without transferring four constants for every row.
      const offer = genericProductOffer(
        { ...row, imageUrl: null, conditionalOffers: [], canonicalId: null, retailerCount: 0 },
        now,
      );
      if (offer) retailers[offer.retailerId]!.publicGeneric++;
    }
    if (page.rows.length < catalogPolicy.batchSize) break;
    cursor = z.object({ listing: z.object({ id: z.uuid() }) }).parse(page.rows.at(-1)).listing.id;
  }
  return { totals: { known: retainedListings }, retailers };
}

/** Exports only operational counts, never queries or account data. */
export async function inspectCatalogHealth(
  db = createDatabase(),
  now = new Date(),
  skippedByCapacity: number | null = null,
  progress?: ReportProgress,
) {
  // Finish each stage before starting another: a rejected read must not leave
  // the other stage issuing more requests after the CLI has reported failure.
  progress?.("Salud: leyendo últimas cargas por tienda");
  const operations = await readHealthStep(
    "operations",
    () => inspectOperations(db, now, true),
    progress,
  );
  const coverage = await inspectHealthCounts(db, now, progress);
  progress?.("Salud: evaluando reporte");

  return evaluateCatalogHealth(
    {
      retainedListings: coverage.totals.known,
      skippedByCapacity,
      retailers: operations.map((operation) => {
        const retailerCoverage = coverage.retailers[operation.retailer];

        if (!retailerCoverage) {
          throw new Error("Missing retailer coverage in catalog health snapshot");
        }

        return {
          retailer: operation.retailer,
          latestAttempt: operation.latestAttempt,
          latestSuccess: operation.latestSuccess,
          known: retailerCoverage.known,
          freshSearchableOffers: retailerCoverage.publicGeneric,
        };
      }),
    },
    now,
  );
}
