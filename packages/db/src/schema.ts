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
  foreignKey,
  date,
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

export const discoveryQueries = pgTable(
  "discovery_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedQuery: text("normalized_query").notNull(),
    originalQuery: text("original_query").notNull(),
    firstRequestedAt: time("first_requested_at").notNull().defaultNow(),
    lastRequestedAt: time("last_requested_at").notNull().defaultNow(),
    requestCount: integer("request_count").notNull().default(1),
    lastAttemptedAt: time("last_attempted_at"),
    lastCompletedAt: time("last_completed_at"),
    nextEligibleAt: time("next_eligible_at").notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    latestResultCount: integer("latest_result_count").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("discovery_query_identity").on(t.normalizedQuery),
    index("discovery_eligibility").on(t.nextEligibleAt),
    check(
      "discovery_query_lengths",
      sql`length(${t.normalizedQuery}) between 3 and 80 and length(${t.originalQuery}) between 1 and 240`,
    ),
    check(
      "discovery_counts",
      sql`${t.requestCount} > 0 and ${t.latestResultCount} between 0 and 30`,
    ),
    check(
      "discovery_status",
      sql`${t.status} in ('pending','processing','completed','no_results','partial','failed')`,
    ),
    check(
      "discovery_times",
      sql`${t.lastRequestedAt} >= ${t.firstRequestedAt} and (${t.lastAttemptedAt} is null or ${t.nextEligibleAt} >= ${t.lastAttemptedAt} + interval '24 hours')`,
    ),
  ],
);

/** Durable budget also counts interrupted attempts, independently of query retries. */
export const discoveryDailyBudget = pgTable(
  "discovery_daily_budget",
  {
    day: date("day").primaryKey(),
    processed: integer("processed").notNull().default(0),
  },
  (t) => [check("discovery_daily_cap", sql`${t.processed} between 0 and 30`)],
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
    uniqueIndex("listing_id_retailer").on(t.id, t.retailerId),
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

export const canonicalProducts = pgTable(
  "canonical_products",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    brandKey: text("brand_key").notNull(),
    quantityValue: integer("quantity_value").notNull(),
    quantityUnit: text("quantity_unit").notNull(),
    packageCount: integer("package_count").notNull(),
    totalQuantityValue: integer("total_quantity_value").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "canonical_content",
      sql`${t.quantityValue}>0 and ${t.quantityUnit} in ('g','ml','unit') and ${t.packageCount}>0 and ${t.totalQuantityValue}::bigint=${t.quantityValue}::bigint*${t.packageCount}::bigint`,
    ),
  ],
);
export const canonicalProductListings = pgTable(
  "canonical_product_listings",
  {
    listingId: uuid("listing_id")
      .primaryKey()
      .references(() => retailerListings.id, { onDelete: "cascade" }),
    canonicalProductId: uuid("canonical_product_id")
      .notNull()
      .references(() => canonicalProducts.id, { onDelete: "cascade" }),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    confidence: numeric("confidence").notNull(),
    matchingVersion: integer("matching_version").notNull(),
    method: text("method").notNull(),
    reasons: text("reasons").array().notNull(),
    linkedAt: time("linked_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("canonical_one_retailer").on(t.canonicalProductId, t.retailerId),
    foreignKey({
      name: "canonical_listing_retailer",
      columns: [t.listingId, t.retailerId],
      foreignColumns: [retailerListings.id, retailerListings.retailerId],
    }).onDelete("cascade"),
    check(
      "canonical_confidence",
      sql`${t.confidence}>=0 and ${t.confidence}<=1 and ${t.matchingVersion}>0`,
    ),
    check("canonical_method", sql`${t.method} in ('automatic','manual')`),
  ],
);
