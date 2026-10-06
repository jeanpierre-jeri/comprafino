import { catalogPolicy } from "@comprafino/core";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listingSchema } from "@comprafino/core";
import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { ingestionRuns, retailerListings } from "./schema.ts";

export interface Acquisition {
  source: "category" | "discovery" | "targeted";
  queryId?: string;
}

type Database = ReturnType<typeof createDatabase>;

/** Capacity-filtered sample commits atomically; shared lock serializes identity admission. */
export function persistenceStatements(
  retailer: RetailerId,
  input: readonly NormalizedRetailerListing[],
  acquisition: Acquisition = { source: "category" },
) {
  if (acquisition.source === "discovery") {
    z.uuid().parse(acquisition.queryId);
  }

  const origin = acquisition.source === "targeted" ? "unknown" : acquisition.source;
  const listings = input.map((listing) => listingSchema.parse(listing));

  if (listings.some((listing) => listing.retailer !== retailer)) {
    throw new Error("Mixed retailers in ingestion");
  }

  if (new Set(listings.map((listing) => listing.externalId)).size !== listings.length) {
    throw new Error("Duplicate listing identities in batch");
  }

  if (!listings.length) {
    throw new Error("Empty persistence batch");
  }

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
      offers: listing.conditionalOffers ?? [],
    })),
  );
  const ids = JSON.stringify(listings.map((listing) => listing.externalId));
  const scope = sql`l.retailer_id = ${retailer} and l.external_id in (select jsonb_array_elements_text(${ids}::jsonb))`;

  return [
    // Serialize new identity admission across retailers; existing quote updates remain allowed at the cap.
    sql`with catalog_lock as materialized (select pg_advisory_xact_lock(hashtext('comprafino:catalog-admission')))
      select id from retailers cross join catalog_lock where id = ${retailer} for update of retailers`,
    // Under the preceding admission lock, retain all known identities and only
    // the first new identities that fit. Source order determines admission.
    sql`
      with incoming_ids as materialized (
        select external_id, position,
          exists(select 1 from retailer_listings l where l.retailer_id=${retailer} and l.external_id=incoming.external_id) as known
        from jsonb_array_elements_text(${ids}::jsonb) with ordinality incoming(external_id, position)
      ), new_identities as (
        select external_id, row_number() over (order by position) as priority
        from incoming_ids where not known
      ), admitted as materialized (
        select external_id from incoming_ids where known
        union all
        select external_id from new_identities
        where priority <= greatest(0, ${catalogPolicy.retainedListingCap} - (select count(*) from retailer_listings))
      ), updated as (insert into retailer_listings (retailer_id, external_id, product_id, title, url, image_url,
        current_price_cents, regular_price_cents, currency, price_unit, available, source_brand, source_unit_multiplier, package_text, category, first_seen_at, last_seen_at, first_seen_via, discovery_query_id, last_category_observed_at, availability_verified_at)
      select retailer_id, external_id, product_id, title, url, image_url, current_price_cents,
        regular_price_cents, currency, price_unit, available, source_brand, source_unit_multiplier, package_text, category, observed_at, observed_at,
        ${origin}, ${acquisition.queryId ?? null}::uuid, case when ${acquisition.source}='category' then observed_at else null end,
        case when available is not null then observed_at else null end
      from jsonb_to_recordset(${payload}::jsonb) as x(retailer_id text, external_id text, product_id text,
        title text, url text, image_url text, current_price_cents integer, regular_price_cents integer,
        currency text, price_unit text, available boolean, source_brand text, source_unit_multiplier numeric, package_text text, category text, observed_at timestamptz) where external_id in (select external_id from admitted)
      on conflict (retailer_id, external_id) do update set
        product_id = excluded.product_id, title = excluded.title, url = excluded.url, image_url = excluded.image_url,
        current_price_cents = excluded.current_price_cents, regular_price_cents = excluded.regular_price_cents,
        currency = excluded.currency, price_unit = excluded.price_unit,
        available = case when excluded.available is not null and
          (retailer_listings.availability_verified_at is null or retailer_listings.availability_verified_at <= excluded.last_seen_at)
          then excluded.available else retailer_listings.available end,
        availability_verified_at = case when excluded.available is not null and
          (retailer_listings.availability_verified_at is null or retailer_listings.availability_verified_at <= excluded.last_seen_at)
          then excluded.last_seen_at else retailer_listings.availability_verified_at end,
        exact_missing_count = case when retailer_listings.last_exact_missing_at is null or retailer_listings.last_exact_missing_at <= excluded.last_seen_at
          then 0 else retailer_listings.exact_missing_count end,
        last_exact_missing_at = case when retailer_listings.last_exact_missing_at is null or retailer_listings.last_exact_missing_at <= excluded.last_seen_at
          then null else retailer_listings.last_exact_missing_at end,
        source_brand = excluded.source_brand, source_unit_multiplier = excluded.source_unit_multiplier,
        package_text = excluded.package_text, category = excluded.category, last_seen_at = excluded.last_seen_at, active = true,
        last_category_observed_at = coalesce(excluded.last_category_observed_at, retailer_listings.last_category_observed_at)
      where retailer_listings.last_seen_at < excluded.last_seen_at returning id, external_id, available, (xmax=0) as inserted),
      incoming as (
        select u.id, x.observed_at, x.offers from updated u
        join jsonb_to_recordset(${payload}::jsonb) as x(external_id text, observed_at timestamptz, offers jsonb)
        on x.external_id=u.external_id
      ), invalidated as (
        -- Base-table reads use the pre-upsert snapshot. Only accepted newer observations
        -- can invalidate identity confidence; price/stock-only updates and replays cannot.
        update canonical_product_listings a set confidence=0
        from updated u join retailer_listings l on l.id=u.id
        join jsonb_to_recordset(${payload}::jsonb) as x(external_id text,title text,price_unit text,
          package_text text,source_brand text,source_unit_multiplier numeric) on x.external_id=l.external_id
        where a.listing_id=u.id and a.method='automatic'
          and (l.title,l.price_unit,l.package_text,l.source_brand,l.source_unit_multiplier)
            is distinct from (x.title,x.price_unit,x.package_text,x.source_brand,x.source_unit_multiplier)
      ), covered as (
        insert into listing_observation_days (listing_id, observation_date, first_observed_at, last_observed_at, observation_count)
        select u.id, (x.observed_at at time zone 'America/Lima')::date, x.observed_at, x.observed_at, 1
        from updated u join jsonb_to_recordset(${payload}::jsonb)
          as x(external_id text, observed_at timestamptz, current_price_cents integer, available boolean)
          on x.external_id=u.external_id
        where x.current_price_cents > 0 and u.available is distinct from false
        on conflict (listing_id, observation_date) do update set
          first_observed_at=least(listing_observation_days.first_observed_at, excluded.first_observed_at),
          last_observed_at=greatest(listing_observation_days.last_observed_at, excluded.last_observed_at),
          observation_count=listing_observation_days.observation_count+1
      ), removed as (
        delete from retailer_listing_offers o using incoming i where o.listing_id=i.id
        and not exists (select 1 from jsonb_array_elements(i.offers) v where v->>'programKey'=o.program_key)
      ), saved as (
        insert into retailer_listing_offers (listing_id,program_key,condition_type,condition_label,price_cents,observed_at,starts_at,ends_at)
        select i.id,v->>'programKey',v->>'conditionType',v->>'conditionLabel',(v->>'priceCents')::integer,
          i.observed_at,(v->>'startsAt')::timestamptz,(v->>'endsAt')::timestamptz
        from incoming i cross join lateral jsonb_array_elements(i.offers) v
        on conflict (listing_id,program_key) do update set
          condition_type=excluded.condition_type, condition_label=excluded.condition_label,
          price_cents=excluded.price_cents, observed_at=excluded.observed_at,
          starts_at=excluded.starts_at, ends_at=excluded.ends_at
        where (retailer_listing_offers.condition_type,retailer_listing_offers.condition_label,retailer_listing_offers.price_cents,retailer_listing_offers.starts_at,retailer_listing_offers.ends_at)
          is distinct from (excluded.condition_type,excluded.condition_label,excluded.price_cents,excluded.starts_at,excluded.ends_at)
      ) select
        (select count(*)::int from updated) as persisted,
        (select count(*)::int from updated where inserted) as created,
        (select count(*)::int from incoming_ids where external_id not in (select external_id from admitted)) as skipped_by_capacity`,
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
  acquisition: Acquisition = { source: "category" },
) {
  const { persisted, changed, skippedByCapacity } = await persistListingsDetailed(
    db,
    retailer,
    input,
    acquisition,
  );

  return { persisted, changed, skippedByCapacity };
}

/** Same atomic ingestion batch, exposing insert counts for discovery metrics. */
export async function persistListingsDetailed(
  db: Database,
  retailer: RetailerId,
  input: readonly NormalizedRetailerListing[],
  acquisition: Acquisition = { source: "category" },
) {
  if (!input.length) return { persisted: 0, changed: 0, created: 0, skippedByCapacity: 0 };

  const statements = persistenceStatements(retailer, input, acquisition);
  const results = await db.batch([
    db.execute(statements[0]),
    db.execute(statements[1]),
    db.execute(statements[2]),
    db.execute(statements[3]),
  ]);
  const [summary] = z
    .array(
      z.object({
        persisted: z.number().int().nonnegative(),
        created: z.number().int().nonnegative(),
        skipped_by_capacity: z.number().int().nonnegative(),
      }),
    )
    .length(1)
    .parse(results[1].rows);

  if (!summary) {
    throw new Error("Missing persistence summary");
  }

  return {
    persisted: summary.persisted,
    changed: results[3].rows.length,
    created: summary.created,
    skippedByCapacity: summary.skipped_by_capacity,
  };
}

export function createIngestionStore(db = createDatabase()) {
  return {
    async start(retailer: RetailerId) {
      const [run] = await db
        .insert(ingestionRuns)
        .values({ retailerId: retailer })
        .returning({ id: ingestionRuns.id });

      if (!run) {
        throw new Error("Failed to create ingestion run");
      }

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
