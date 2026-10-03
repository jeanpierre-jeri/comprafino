import { sql } from "drizzle-orm";
import {
  pgTable,
  numeric,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const retailers = pgTable(
  "retailers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
  },
  (t) => [check("retailer_identity", sql`${t.id} in ('tottus', 'plaza-vea', 'metro')`)],
);
export const retailerListings = pgTable(
  "retailer_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    externalId: text("external_id").notNull(),
    productId: text("product_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    imageUrl: text("image_url"),
    currentPriceCents: integer("current_price_cents").notNull(),
    regularPriceCents: integer("regular_price_cents"),
    currency: text("currency").notNull(),
    priceUnit: text("price_unit").notNull(),
    available: boolean("available"),
    sourceBrand: text("source_brand"),
    sourceUnitMultiplier: numeric("source_unit_multiplier"),
    packageText: text("package_text"),
    category: text("category"),
    firstSeenAt: time("first_seen_at").notNull(),
    lastSeenAt: time("last_seen_at").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("listing_source_identity").on(t.retailerId, t.externalId),
    index("listing_last_seen").on(t.lastSeenAt),
    check(
      "listing_money",
      sql`${t.currentPriceCents} >= 0 and (${t.regularPriceCents} is null or ${t.regularPriceCents} >= 0)`,
    ),
    check("listing_currency", sql`${t.currency} = 'PEN'`),
    check("listing_unit", sql`${t.priceUnit} in ('KG', 'UN')`),
    check("listing_times", sql`${t.lastSeenAt} >= ${t.firstSeenAt}`),
  ],
);
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => retailerListings.id),
    currentPriceCents: integer("current_price_cents").notNull(),
    regularPriceCents: integer("regular_price_cents"),
    currency: text("currency").notNull(),
    priceUnit: text("price_unit").notNull(),
    validFrom: time("valid_from").notNull(),
    validUntil: time("valid_until"),
  },
  (t) => [
    uniqueIndex("one_current_price_state")
      .on(t.listingId)
      .where(sql`${t.validUntil} is null`),
    uniqueIndex("price_state_start").on(t.listingId, t.validFrom),
    check("history_times", sql`${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`),
    check(
      "history_money",
      sql`${t.currentPriceCents} >= 0 and (${t.regularPriceCents} is null or ${t.regularPriceCents} >= 0)`,
    ),
    check("history_currency", sql`${t.currency} = 'PEN'`),
    check("history_unit", sql`${t.priceUnit} in ('KG', 'UN')`),
  ],
);
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    startedAt: time("started_at").notNull().defaultNow(),
    endedAt: time("ended_at"),
    status: text("status").notNull().default("running"),
    listingsFetched: integer("listings_fetched").notNull().default(0),
    listingsPersisted: integer("listings_persisted").notNull().default(0),
    listingsChanged: integer("listings_changed").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    index("run_started").on(t.startedAt),
    check("run_status", sql`${t.status} in ('running', 'success', 'failed')`),
    check(
      "run_counts",
      sql`${t.listingsFetched} >= 0 and ${t.listingsPersisted} >= 0 and ${t.listingsChanged} >= 0`,
    ),
  ],
);

/** Recomputable derived data; source truth remains in retailer_listings. */
export const listingNormalizations = pgTable(
  "listing_normalizations",
  {
    listingId: uuid("listing_id")
      .primaryKey()
      .references(() => retailerListings.id, { onDelete: "cascade" }),
    normalizationVersion: integer("normalization_version").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    brand: text("brand"),
    brandKey: text("brand_key"),
    brandSource: text("brand_source"),
    quantityValue: integer("quantity_value"),
    quantityUnit: text("quantity_unit"),
    packageCount: integer("package_count"),
    totalQuantityValue: integer("total_quantity_value"),
    totalQuantityUnit: text("total_quantity_unit"),
    pricingBasis: text("pricing_basis").notNull(),
    soldByWeight: boolean("sold_by_weight").notNull(),
    issues: text("issues").array().notNull(),
    normalizedAt: time("normalized_at").notNull().defaultNow(),
  },
  (t) => [
    index("normalization_dimensions").on(
      t.brandKey,
      t.quantityUnit,
      t.quantityValue,
      t.packageCount,
    ),
    check("normalization_version", sql`${t.normalizationVersion} > 0`),
    check(
      "normalization_brand",
      sql`(${t.brand} is null and ${t.brandKey} is null and ${t.brandSource} is null) or (${t.brand} is not null and ${t.brandKey} is not null and ${t.brandSource} is not null and ${t.brandSource} in ('source', 'title'))`,
    ),
    check(
      "normalization_quantity",
      sql`(${t.quantityValue} is null and ${t.quantityUnit} is null) or (${t.quantityValue} is not null and ${t.quantityValue} > 0 and ${t.quantityUnit} is not null and ${t.quantityUnit} in ('g', 'ml', 'unit'))`,
    ),
    check("normalization_count", sql`${t.packageCount} is null or ${t.packageCount} > 0`),
    check(
      "normalization_total",
      sql`(${t.totalQuantityValue} is null and ${t.totalQuantityUnit} is null) or (${t.totalQuantityValue} is not null and ${t.totalQuantityValue} > 0 and ${t.quantityValue} is not null and ${t.packageCount} is not null and ${t.totalQuantityUnit} is not null and ${t.totalQuantityUnit} = ${t.quantityUnit} and ${t.totalQuantityValue}::bigint = ${t.quantityValue}::bigint * ${t.packageCount}::bigint)`,
    ),
    check(
      "normalization_basis",
      sql`(${t.pricingBasis} = 'kg' and ${t.soldByWeight} and ${t.quantityValue} is null and ${t.packageCount} is null) or (${t.pricingBasis} = 'unit' and not ${t.soldByWeight})`,
    ),
  ],
);
