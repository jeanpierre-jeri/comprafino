import { desc, eq, sql } from "drizzle-orm";
import { listingSchema } from "@comprafino/core";
import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { ingestionRuns, retailerListings } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>;
/** Entire bounded sample commits atomically. Row lock serializes writers for a retailer. */
export function persistenceStatements(
  retailer: RetailerId,
  input: readonly NormalizedRetailerListing[],
) {
  const listings = input.map((listing) => listingSchema.parse(listing));
  if (listings.some((listing) => listing.retailer !== retailer))
    throw new Error("Mixed retailers in ingestion");
  if (new Set(listings.map((listing) => listing.externalId)).size !== listings.length)
    throw new Error("Duplicate listing identities in batch");
  if (!listings.length) throw new Error("Empty persistence batch");
  const payload = JSON.stringify(
    listings.map((listing) => ({
      retailer_id: listing.retailer,
      external_id: listing.externalId,
      product_id: listing.productId,
      title: listing.title,
      url: listing.url,
      image_url: listing.imageUrl ?? null,
      current_price_cents: listing.currentPriceCents,
      regular_price_cents: listing.regularPriceCents ?? null,
      currency: listing.currency,
      price_unit: listing.priceUnit,
      available: listing.available ?? null,
      source_brand: listing.sourceBrand ?? null,
      source_unit_multiplier: listing.sourceUnitMultiplier ?? null,
      package_text: listing.packageText ?? null,
      category: listing.category ?? null,
      observed_at: listing.observedAt.toISOString(),
    })),
  );
  const ids = JSON.stringify(listings.map((listing) => listing.externalId));
  const scope = sql`l.retailer_id = ${retailer} and l.external_id in (select jsonb_array_elements_text(${ids}::jsonb))`;
  return [
    sql`select id from retailers where id = ${retailer} for update`,
    sql`
      insert into retailer_listings (retailer_id, external_id, product_id, title, url, image_url,
        current_price_cents, regular_price_cents, currency, price_unit, available, source_brand, source_unit_multiplier, package_text, category, first_seen_at, last_seen_at)
      select retailer_id, external_id, product_id, title, url, image_url, current_price_cents,
        regular_price_cents, currency, price_unit, available, source_brand, source_unit_multiplier, package_text, category, observed_at, observed_at
      from jsonb_to_recordset(${payload}::jsonb) as x(retailer_id text, external_id text, product_id text,
        title text, url text, image_url text, current_price_cents integer, regular_price_cents integer,
        currency text, price_unit text, available boolean, source_brand text, source_unit_multiplier numeric, package_text text, category text, observed_at timestamptz)
      on conflict (retailer_id, external_id) do update set
        product_id = excluded.product_id, title = excluded.title, url = excluded.url, image_url = excluded.image_url,
        current_price_cents = excluded.current_price_cents, regular_price_cents = excluded.regular_price_cents,
        currency = excluded.currency, price_unit = excluded.price_unit, available = excluded.available,
        source_brand = excluded.source_brand, source_unit_multiplier = excluded.source_unit_multiplier,
        package_text = excluded.package_text, category = excluded.category, last_seen_at = excluded.last_seen_at, active = true
      where retailer_listings.last_seen_at < excluded.last_seen_at returning id`,
    sql`
      update price_history h set valid_until = l.last_seen_at from retailer_listings l
      where h.listing_id = l.id and h.valid_until is null and ${scope}
        and (h.current_price_cents, h.regular_price_cents, h.currency, h.price_unit)
          is distinct from (l.current_price_cents, l.regular_price_cents, l.currency, l.price_unit)`,
    sql`
      insert into price_history (listing_id, current_price_cents, regular_price_cents, currency, price_unit, valid_from)
      select l.id, l.current_price_cents, l.regular_price_cents, l.currency, l.price_unit, l.last_seen_at
      from retailer_listings l where ${scope}
        and not exists (select 1 from price_history h where h.listing_id = l.id and h.valid_until is null)
      returning id`,
  ] as const;
}
export async function persistListings(
  db: Database,
  retailer: RetailerId,
  input: readonly NormalizedRetailerListing[],
) {
  if (!input.length) return { persisted: 0, changed: 0 };
  const statements = persistenceStatements(retailer, input);
  const results = await db.batch([
    db.execute(statements[0]),
    db.execute(statements[1]),
    db.execute(statements[2]),
    db.execute(statements[3]),
  ]);
  return { persisted: results[1].rows.length, changed: results[3].rows.length };
}
export function createIngestionStore(db = createDatabase()) {
  return {
    async start(retailer: RetailerId) {
      const [run] = await db
        .insert(ingestionRuns)
        .values({ retailerId: retailer })
        .returning({ id: ingestionRuns.id });
      if (!run) throw new Error("Failed to create ingestion run");
      return run.id;
    },
    persist: (retailer: RetailerId, listings: readonly NormalizedRetailerListing[]) =>
      persistListings(db, retailer, listings),
    async finish(
      id: string,
      result: {
        status: "success" | "failed";
        fetched: number;
        persisted: number;
        changed: number;
        error?: string;
      },
    ) {
      await db
        .update(ingestionRuns)
        .set({
          status: result.status,
          endedAt: new Date(),
          listingsFetched: result.fetched,
          listingsPersisted: result.persisted,
          listingsChanged: result.changed,
          error: result.error ?? null,
        })
        .where(eq(ingestionRuns.id, id));
    },
  };
}
export async function inspectIngestion(db = createDatabase()) {
  const [runs, listings] = await Promise.all([
    db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(10),
    db.select().from(retailerListings).orderBy(desc(retailerListings.lastSeenAt)).limit(30),
  ]);
  return { runs, listings };
}
