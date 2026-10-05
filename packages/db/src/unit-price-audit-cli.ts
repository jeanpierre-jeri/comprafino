import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { formatUnitPrice } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { catalogRecordSchema, catalogFingerprint } from "./catalog.ts";
import { genericProductOffer, searchPublicProducts } from "./generic-offers.ts";
const auditRowSchema = z.object({
  listing: catalogRecordSchema,
  retailerName: z.string(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  currentPriceCents: z.number().int(),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable(),
  fingerprint: z.string().nullable(),
  version: z.number().int().nullable(),
  association: z.uuid().nullable(),
});
try {
  if (process.argv.slice(2).some((arg) => arg !== "--")) throw new Error("No options supported");
  const db = createDatabase();
  const now = new Date();
  const rows =
    await db.execute(sql`select jsonb_build_object('id',l.id,'retailerId',l.retailer_id,'title',l.title,'priceUnit',h.price_unit,'packageText',l.package_text,'sourceBrand',l.source_brand,'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,
    r.name as "retailerName", l.url,l.image_url as "imageUrl",h.current_price_cents as "currentPriceCents",l.last_seen_at as "observedAt",l.available,n.input_fingerprint as fingerprint,n.normalization_version as version,a.canonical_product_id as association
    from retailer_listings l join retailers r on r.id=l.retailer_id join price_history h on h.listing_id=l.id and h.valid_until is null
    left join listing_normalizations n on n.listing_id=l.id left join canonical_product_listings a on a.listing_id=l.id
    where l.active and h.price_unit=l.price_unit and h.currency='PEN' order by l.retailer_id,l.title limit ${catalogPolicy.overflowSentinel}`);
  if (rows.rows.length > catalogPolicy.retainedListingCap)
    throw new Error("Catalog bound exceeded");
  const raw = z.array(auditRowSchema).parse(rows.rows);
  const eligible = raw.flatMap((row) => {
    if (row.fingerprint === null || row.version === null) return [];
    const offer = genericProductOffer({ ...row, canonicalId: null, retailerCount: 0 }, now);
    return offer ? [{ row, offer }] : [];
  });
  const detail = (entry: (typeof eligible)[number]) => {
    const { row, offer } = entry;
    // Independent bigint arithmetic cross-check, before display rounding.
    if (offer.unitPrice) {
      const factor =
        offer.pricingBasis === "kg" || offer.totalQuantity!.unit === "unit" ? 1n : 1000n;
      const divisor = offer.pricingBasis === "kg" ? 1n : BigInt(offer.totalQuantity!.value);
      if (
        offer.unitPrice.numerator * divisor !==
        BigInt(row.currentPriceCents) * factor * offer.unitPrice.denominator
      )
        throw new Error("Audit arithmetic mismatch");
    }
    return {
      title: offer.title,
      brand: offer.brand,
      retailer: offer.retailerId,
      priceCents: offer.currentPriceCents,
      pricingBasis: offer.pricingBasis,
      quantity: offer.quantity,
      packageCount: offer.packageCount,
      totalQuantity: offer.totalQuantity,
      association: row.association,
      unitPrice: offer.unitPrice,
      display: offer.unitPrice ? formatUnitPrice(offer.unitPrice) : null,
      reason: offer.unitPriceUnavailableReason,
    };
  };
  const categories = [
    "huevo",
    "arroz",
    "azúcar",
    "aceite",
    "leche",
    "pasta",
    "harina",
    "avena",
    "detergente",
  ].map((term) => {
    const matches = eligible.filter((e) => e.offer.title.toLowerCase().includes(term));
    return {
      term,
      eligible: matches.length,
      withUnitPrice: matches.filter((e) => e.offer.unitPrice).length,
      withoutUnitPrice: matches.filter((e) => !e.offer.unitPrice).length,
    };
  });
  const samples = {
    eggs: eligible
      .filter((e) => /^huevos?\b/iu.test(e.offer.title))
      .slice(0, 40)
      .map(detail),
    mass: eligible
      .filter(
        (e) =>
          /^(?:arroz|azúcar|harina|pasta|avena)\b/iu.test(e.offer.title) &&
          e.offer.unitPrice?.dimension === "mass",
      )
      .slice(0, 20)
      .map(detail),
    volume: eligible
      .filter(
        (e) => /aceite|leche/iu.test(e.offer.title) && e.offer.unitPrice?.dimension === "volume",
      )
      .slice(0, 15)
      .map(detail),
    directKg: eligible
      .filter((e) => e.offer.pricingBasis === "kg")
      .slice(0, 5)
      .map(detail),
    ambiguous: eligible
      .filter((e) => !e.offer.unitPrice)
      .slice(0, 20)
      .map(detail),
  };
  const searches = [];
  for (const query of [
    "huevos",
    "arroz",
    "azúcar",
    "aceite",
    "leche",
    "harina",
    "avena",
    "pasta",
    "detergente",
  ]) {
    const result = await searchPublicProducts(db, query, "relevance", now);
    const total = await searchPublicProducts(db, query, "total-price", now);
    const unit = await searchPublicProducts(db, query, "unit-price", now);
    const cheapestByDimension = ["mass", "volume", "count"].flatMap((dimension) => {
      const first = unit.offers.find((o) => o.unitPrice?.dimension === dimension);
      return first
        ? [
            {
              dimension,
              title: first.title,
              retailer: first.retailerId,
              priceCents: first.currentPriceCents,
              display: formatUnitPrice(first.unitPrice!),
              id: first.id,
            },
          ]
        : [];
    });
    const first = total.offers.find((o) => o.pricingBasis === "unit");
    searches.push({
      query,
      canonicalResults: result.products.length,
      genericResults: result.offers.length,
      resultLimit: 30,
      dimensions: [
        ...new Set(result.offers.flatMap((o) => (o.unitPrice ? [o.unitPrice.dimension] : []))),
      ],
      unitPriceCoverage: result.offers.filter((o) => o.unitPrice).length,
      cheapestPackage: first
        ? {
            title: first.title,
            retailer: first.retailerId,
            priceCents: first.currentPriceCents,
            id: first.id,
          }
        : null,
      cheapestByDimension,
    });
  }
  const reasons: Record<string, number> = {};
  for (const e of eligible)
    if (e.offer.unitPriceUnavailableReason)
      reasons[e.offer.unitPriceUnavailableReason] =
        (reasons[e.offer.unitPriceUnavailableReason] ?? 0) + 1;
  const staleNormalization = raw.filter(
    (r) => r.fingerprint !== catalogFingerprint(r.listing),
  ).length;
  // Exercise exact comparisons independently; this does not write or claim discovery.
  const exact = await searchPublicProducts(db, "gloria 946", "relevance", now);
  console.log(
    JSON.stringify(
      {
        observedAt: now.toISOString(),
        knownActiveOpenOffers: raw.length,
        eligibleOffers: eligible.length,
        withUnitPrice: eligible.filter((e) => e.offer.unitPrice).length,
        withoutUnitPrice: eligible.filter((e) => !e.offer.unitPrice).length,
        reasons,
        staleNormalization,
        categories,
        samples,
        searches,
        exactGloria946: exact.products.length,
      },
      (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
} catch {
  console.error(
    "Read-only unit-price audit failed. Check database configuration and migrations; no credentials logged.",
  );
  process.exitCode = 1;
}
