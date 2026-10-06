import { matchingThresholds } from "@comprafino/core";
import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  knownListingSchema,
  matchingVersion,
  selectListingRefresh,
  parseListingRefreshOptions,
  classifyProductFamily,
  calculateUnitPrice,
  getSubstitutionProfile,
  normalizeCatalogListing,
  normalizationVersion,
} from "@comprafino/core";
import { catalogRecordSchema, catalogFingerprint } from "./catalog.ts";
import type { KnownListing } from "@comprafino/core";
import type { createDatabase } from "./client.ts";

type Database = ReturnType<typeof createDatabase>;

export async function knownListings(db: Database) {
  const result =
    await db.execute(sql`select l.id,l.retailer_id as retailer,l.external_id as "externalId",
    l.product_id as "productId",l.url,l.last_seen_at as "observedAt",l.available,
    l.availability_verified_at as "availabilityVerifiedAt",l.first_seen_via as "firstSeenVia",
    l.last_category_observed_at as "lastCategoryObservedAt",
    jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,'priceUnit',l.price_unit,
      'packageText',l.package_text,'sourceBrand',l.source_brand,'sourceUnitMultiplier',l.source_unit_multiplier::float8) as catalog,
    l.category, n.normalization_version as version,n.input_fingerprint as fingerprint,l.last_targeted_attempt_at as "lastTargetedAttemptAt",
    exists (select 1 from canonical_product_listings a where a.listing_id=l.id
      and a.method='automatic' and a.matching_version=${matchingVersion} and a.confidence>=${matchingThresholds.auto}
      and not exists (select 1 from canonical_product_listings bad where bad.canonical_product_id=a.canonical_product_id
        and (bad.method<>'automatic' or bad.matching_version<>${matchingVersion} or bad.confidence<${matchingThresholds.auto}))
      and (select count(*) from canonical_product_listings peer where peer.canonical_product_id=a.canonical_product_id)>=2) as public
    from retailer_listings l left join listing_normalizations n on n.listing_id=l.id order by l.id limit ${catalogPolicy.overflowSentinel}`);
  const rows = result.rows.map((raw) => {
    const row = knownListingSchema.parse(raw);
    const evidence = z
      .object({
        catalog: catalogRecordSchema,
        category: z.string().nullable(),
        version: z.number().nullable(),
        fingerprint: z.string().nullable(),
      })
      .parse(raw);
    const currentNormalization =
      evidence.version === normalizationVersion &&
      evidence.fingerprint === catalogFingerprint(evidence.catalog);
    const family = classifyProductFamily({
      title: evidence.catalog.title,
      retailerId: row.retailer,
      sourceCategory: evidence.category,
    });
    const attributes = normalizeCatalogListing(evidence.catalog);
    const at = row.observedAt;
    const quantity = calculateUnitPrice(
      {
        ...attributes,
        title: evidence.catalog.title,
        productFamily: family.family,
        currentPriceCents: 1,
        observedAt: at,
      },
      at,
    );

    return {
      ...row,
      shoppingRelevant:
        currentNormalization &&
        attributes.pricingBasis === "unit" &&
        quantity.price?.quality === "strong" &&
        getSubstitutionProfile({ title: evidence.catalog.title, family }) !== null,
      usefulStaple: currentNormalization && family.family !== null && quantity.price !== null,
    };
  });

  if (rows.length > catalogPolicy.retainedListingCap) {
    throw new Error("Known listing refresh exceeds complete catalog bound");
  }

  return rows;
}

export async function previewListingRefresh(
  db: Database,
  options: ReturnType<typeof parseListingRefreshOptions>,
  now = new Date(),
) {
  const rows = (await knownListings(db)).filter(
    (row) =>
      (!options.retailer || row.retailer === options.retailer) &&
      (!options.externalId || row.externalId === options.externalId),
  );

  // Explicit one-SKU inspection permits live repeat validation without changing scheduler policy.
  return options.externalId ? rows.slice(0, 1) : selectListingRefresh(rows, now, options.limit);
}

export async function claimListingRefresh(db: Database, row: KnownListing, at: Date) {
  const results = await db.batch([
    db.execute(sql`select id from retailers where id=${row.retailer} for update`),
    db.execute(sql`update retailer_listings set last_targeted_attempt_at=${at.toISOString()}::timestamptz,targeted_status='failed'
      where id=${row.id}::uuid and last_seen_at=${row.observedAt.toISOString()}::timestamptz
      and last_targeted_attempt_at is not distinct from ${row.lastTargetedAttemptAt?.toISOString() ?? null}::timestamptz returning id`),
  ]);

  return results[1].rows.length === 1;
}

export async function finishListingRefresh(
  db: Database,
  row: KnownListing,
  at: Date,
  status: "observed" | "unavailable" | "not-found" | "failed",
) {
  await db.batch([
    db.execute(sql`select id from retailers where id=${row.retailer} for update`),
    db.execute(sql`update retailer_listings set targeted_status=${status},
      available=case when ${status}='unavailable' then false else available end,
      availability_verified_at=case when ${status}='unavailable' then ${at.toISOString()}::timestamptz else availability_verified_at end,
      exact_missing_count=case when ${status}='not-found' then exact_missing_count+1
        when ${status}='unavailable' then 0 else exact_missing_count end,
      last_exact_missing_at=case when ${status}='not-found' then ${at.toISOString()}::timestamptz
        when ${status}='unavailable' then null else last_exact_missing_at end
      where id=${row.id}::uuid and last_targeted_attempt_at=${at.toISOString()}::timestamptz
        and (${status} in ('observed','failed') or (last_seen_at<=${at.toISOString()}::timestamptz
          and (availability_verified_at is null or availability_verified_at<=${at.toISOString()}::timestamptz)
          and (last_exact_missing_at is null or last_exact_missing_at<${at.toISOString()}::timestamptz)))`),
  ]);
}
