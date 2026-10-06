import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  calculateUnitPrice,
  classifyProductFamily,
  getSubstitutionProfile,
  genericSubstitutionContexts,
  normalizeCatalogListing,
  normalizationVersion,
  offerFreshness,
  retailerIdSchema,
  shoppingListItemSchema,
} from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { catalogFingerprint, catalogRecordSchema } from "./catalog.ts";
import { eligibleProducts } from "./public-products.ts";
import { currentGenericOfferRows, genericProductOffer } from "./generic-offers.ts";
import {
  publicListingDetailRows,
  publicRetailerListing,
  getPublicRetailerListingDetail,
} from "./listing-detail.ts";
import { evaluateCurrentShoppingList } from "./shopping-list.ts";

const auditRow = z.object({
  listing: catalogRecordSchema,
  category: z.string().nullable(),
  active: z.boolean(),
  available: z.boolean().nullable(),
  observedAt: z.coerce.date(),
  availabilityVerifiedAt: z.coerce.date().nullable(),
  exactMissingCount: z.number().int().nonnegative(),
  lastExactMissingAt: z.coerce.date().nullable(),
  targetedStatus: z.string().nullable(),
  version: z.number().nullable(),
  fingerprint: z.string().nullable(),
  price: z.number().int().nonnegative(),
  canonicalAssociation: z.boolean(),
});

const families = [
  ["eggs", "huevos"],
  ["rice", "arroz"],
  ["cooking_oil", "aceite"],
  ["sugar", "azúcar"],
  ["pasta", "fideos/pasta"],
  ["flour", "harina"],
  ["oats", "avena"],
  ["milk", "leche"],
  ["canned_tuna", "atún"],
  ["detergent", "detergente"],
  ["toilet_paper", "papel higiénico"],
] as const;

/** Complete read-only catalog audit. Quality is measured separately from current eligibility.
 * Missing counters are optional pre-migration, allowing a genuine before snapshot. */
export async function auditCatalogCoverage(db = createDatabase(), now = new Date()) {
  const [base, current, detail, coverage] = await db.batch([
    db.execute(sql`select jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,
      'priceUnit',l.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,
      'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,
      l.category,l.active,l.available,l.last_seen_at as "observedAt",
      (to_jsonb(l)->>'availability_verified_at')::timestamptz as "availabilityVerifiedAt",
      coalesce((to_jsonb(l)->>'exact_missing_count')::int,0) as "exactMissingCount",
      (to_jsonb(l)->>'last_exact_missing_at')::timestamptz as "lastExactMissingAt",
      l.targeted_status as "targetedStatus", n.normalization_version as version,
      n.input_fingerprint as fingerprint,l.current_price_cents as price,
      exists(select 1 from canonical_product_listings a where a.listing_id=l.id) as "canonicalAssociation"
      from retailer_listings l left join listing_normalizations n on n.listing_id=l.id
      order by l.id limit ${catalogPolicy.overflowSentinel}`),
    db.execute(
      sql`${eligibleProducts} ${currentGenericOfferRows(now)} order by l.id limit ${catalogPolicy.overflowSentinel}`,
    ),
    db.execute(
      sql`${eligibleProducts} ${publicListingDetailRows(sql`true`, now)} order by l.id limit ${catalogPolicy.overflowSentinel}`,
    ),
    db.execute(sql`select observation_date as day,count(*)::int as listings,
      sum(observation_count)::int as observations from listing_observation_days
      group by observation_date order by observation_date`),
  ]);

  if ([base, current, detail].some((r) => r.rows.length > catalogPolicy.retainedListingCap)) {
    throw new Error("Catalog audit exceeds 1000 guard");
  }

  const offers = current.rows.map((r) => genericProductOffer(r, now)).filter((r) => r !== null);
  const offerIds = new Set(offers.map((o) => o.id));
  const exactIds = new Set(offers.filter((o) => o.canonicalId).map((o) => o.id));
  const details = detail.rows.map((r) => publicRetailerListing(r, now)).filter((r) => r !== null);
  const detailIds = new Set(details.map((r) => r.id));
  const rows = z
    .array(auditRow)
    .parse(base.rows)
    .map((r) => {
      const attributes = normalizeCatalogListing(r.listing);
      const family = classifyProductFamily({
        title: r.listing.title,
        retailerId: r.listing.retailerId,
        sourceCategory: r.category,
      });
      const profile = getSubstitutionProfile({ title: r.listing.title, family });
      // No new milk taxonomy: lexical audit bucket only, with no safety implication.
      const bucket = family.family ?? (/^leche\b/iu.test(r.listing.title) ? "milk" : "other");
      const quantity = calculateUnitPrice(
        {
          ...attributes,
          title: r.listing.title,
          productFamily: family.family,
          currentPriceCents: r.price,
          observedAt: now,
          available: true,
        },
        now,
      );
      const normalization =
        r.version === normalizationVersion && r.fingerprint === catalogFingerprint(r.listing);
      const safe = offers.find((o) => o.id === r.listing.id);
      const context = profile ? genericSubstitutionContexts[profile] : null;
      let dimension;

      if (safe?.totalQuantity?.unit === "g") {
        dimension = "kg" as const;
      } else if (safe?.totalQuantity?.unit === "ml") {
        dimension = "L" as const;
      } else {
        dimension = "unit" as const;
      }

      const shoppingGeneric = Boolean(
        safe &&
        context &&
        safe.pricingBasis === "unit" &&
        safe.unitPrice?.quality === "strong" &&
        dimension === context.unit,
      );
      const shoppingExact = Boolean(safe?.canonicalId && safe.pricingBasis === "unit");

      return {
        id: r.listing.id,
        retailer: r.listing.retailerId,
        title: r.listing.title,
        family: bucket,
        freshness: offerFreshness(r.observedAt, now),
        available: r.available,
        verifiedAt: r.availabilityVerifiedAt,
        exactMissingCount: r.exactMissingCount,
        lastExactMissingAt: r.lastExactMissingAt,
        targetedStatus: r.targetedStatus,
        active: r.active,
        normalization,
        ordinaryPrice: r.price > 0,
        containedQuantity: attributes.totalQuantity !== null && attributes.pricingBasis === "unit",
        directKgQuote: attributes.pricingBasis === "kg",
        quantityQuality: quantity.price?.quality ?? "withheld",
        quantityReason: quantity.reason,
        profile,
        canonicalAssociation: r.canonicalAssociation,
        publicExact: exactIds.has(r.listing.id),
        publicGeneric: offerIds.has(r.listing.id),
        listingDetail: detailIds.has(r.listing.id),
        shoppingGeneric,
        shoppingExact,
        basket: shoppingGeneric || shoppingExact,
      };
    });

  function summarize(selected: typeof rows) {
    const count = (predicate: (r: (typeof rows)[number]) => boolean) =>
      selected.filter(predicate).length;

    return {
      known: selected.length,
      fresh: count((r) => r.freshness === "fresh"),
      stale: count((r) => r.freshness !== "fresh"),
      tooStale: count((r) => r.freshness === "too-stale"),
      ordinaryPrices: count((r) => r.ordinaryPrice),
      normalized: count((r) => r.normalization),
      strongQuantity: count((r) => r.quantityQuality === "strong"),
      strongContainedQuantity: count((r) => r.quantityQuality === "strong" && r.containedQuantity),
      directKgQuotes: count((r) => r.directKgQuote),
      approximateQuantity: count((r) => r.quantityQuality === "approximate"),
      withheldQuantity: count((r) => r.quantityQuality === "withheld"),
      safeProfile: count((r) => r.profile !== null),
      canonicalAssociation: count((r) => r.canonicalAssociation),
      publicExact: count((r) => r.publicExact),
      publicGeneric: count((r) => r.publicGeneric),
      shoppingGeneric: count((r) => r.shoppingGeneric),
      strictOrPreferredExact: count((r) => r.shoppingExact),
      basket: count((r) => r.basket),
      listingDetail: count((r) => r.listingDetail),
      available: count((r) => r.available === true),
      unavailable: count((r) => r.available === false),
      unknown: count((r) => r.available === null),
      timestampedAvailability: count((r) => r.verifiedAt !== null),
      timestampedAvailable: count((r) => r.available === true && r.verifiedAt !== null),
      timestampedUnavailable: count((r) => r.available === false && r.verifiedAt !== null),
      legacyAvailability: count((r) => r.available !== null && r.verifiedAt === null),
      staleAvailabilityEvidence: count(
        (r) => r.verifiedAt !== null && offerFreshness(r.verifiedAt, now) !== "fresh",
      ),
      latestRequestFailures: count((r) => r.targetedStatus === "failed"),
      suspectedMissing: count((r) => r.exactMissingCount === 1),
      repeatedExactMissing: count((r) => r.exactMissingCount >= 2),
      inactive: count((r) => !r.active),
      searchOnly: count((r) => r.publicGeneric && !r.basket),
    };
  }

  const familyRows = families.map(([family, label]) => {
    const selected = rows.filter((r) => r.family === family);
    const metrics = summarize(selected);
    const safeRetailers = [
      ...new Set(selected.filter((r) => r.shoppingGeneric).map((r) => r.retailer)),
    ];
    let classification;

    if (metrics.safeProfile === 0 && metrics.known > 0) {
      classification = "UNSAFE" as const;
    } else if (metrics.shoppingGeneric < 2) {
      classification = "POOR" as const;
    } else if (safeRetailers.length < 3 || metrics.shoppingGeneric < 6) {
      classification = "LIMITED" as const;
    } else {
      classification = "GOOD" as const;
    }

    return {
      family,
      label,
      classification,
      ...metrics,
      retailers: Object.fromEntries(
        retailerIdSchema.options.map((retailer) => [
          retailer,
          summarize(selected.filter((r) => r.retailer === retailer)),
        ]),
      ),
      canonicalComparisons: new Set(
        offers
          .filter((o) => selected.some((r) => r.id === o.id) && o.canonicalId)
          .map((o) => o.canonicalId),
      ).size,
      gaps: coverageGapDescription(metrics.safeProfile, safeRetailers.length),
    };
  });

  return {
    observedAt: now.toISOString(),
    readOnly: true,
    guard: catalogPolicy.retainedListingCap,
    totals: summarize(rows),
    retailers: Object.fromEntries(
      retailerIdSchema.options.map((retailer) => [
        retailer,
        summarize(rows.filter((r) => r.retailer === retailer)),
      ]),
    ),
    families: familyRows,
    unsupportedAuditFamilies: ["jabón/limpieza básica", "shampoo/personal care"],
    observationDays: z
      .array(
        z.object({ day: z.string(), listings: z.number().int(), observations: z.number().int() }),
      )
      .parse(coverage.rows),
    definitions: {
      quantity: "Intrinsic unit-price quality, independent of freshness/stock",
      shoppingGeneric:
        "Fresh public option, supported safe profile and strong matching contained measure, before need-specific package/overbuy gates",
      strictOrPreferredExact:
        "Fresh trusted canonical sale-package offer; preferred alternative safety is evaluated per need",
      basket:
        "Union of generic potential and exact package potential, not a promise every arbitrary basket is complete",
      availability:
        "True/false/null source evidence; timestamped evidence is prospective, legacy booleans retained",
      missing:
        "Exact lookup absence is suspicion, never proof of permanent deletion or stock absence",
    },
    listings: rows,
  };
}

/** Real DB transport + evaluation timings, not HTTP/deployment latency. */
export async function coverageQueryTimings(db = createDatabase(), now = new Date()) {
  const items = Object.entries(genericSubstitutionContexts)
    .filter(([p]) =>
      ["eggs:regular", "rice:white", "oil:vegetable", "detergent:powder"].includes(p),
    )
    .map(([profile, c], index) =>
      shoppingListItemSchema.parse({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        intent: "generic",
        canonicalId: null,
        query: c.query,
        label: c.label,
        substitutionProfile: profile,
        quantity: { amount: c.unit === "unit" ? 30 : 3, unit: c.unit },
        frequency: "weekly",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    );
  const [sample] = await db.batch([
    db.execute(sql`select id from retailer_listings order by id limit 1`),
  ]);
  const id = z.object({ id: z.uuid() }).parse(sample.rows[0]).id;
  const runs = [];

  for (let i = 0; i < 4; i++) {
    const basket = await evaluateCurrentShoppingList(db, { version: 2, items }, "standard", now);
    const start = performance.now();
    await getPublicRetailerListingDetail(db, id, { now });

    if (i > 0) {
      runs.push({
        basketQueryMs: basket.timings.queryMs,
        basketEvaluationMs: basket.timings.totalMs,
        listingDetailMs: performance.now() - start,
      });
    }
  }

  return {
    samples: runs,
    note: "One warmup, three sequential samples; 4 generic needs, real configured DB. No HTTP endpoint latency claim.",
  };
}

function coverageGapDescription(safeProfiles: number, safeRetailers: number): string {
  if (safeProfiles === 0) {
    return "Generic substitution unsupported; search coverage does not authorize recommendations";
  }

  if (safeRetailers < 3) return "Fresh safe candidates missing from at least one retailer";

  return "No broad retailer gap; specialty forms remain separate";
}
