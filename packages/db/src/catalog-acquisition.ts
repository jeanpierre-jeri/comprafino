import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  catalogSourceSchema,
  catalogSourceClaimSchema,
  retailerIdSchema,
  normalizationVersion,
  matchingVersion,
} from "@comprafino/core";
import type { CatalogSource, CatalogSourceClaim, RetailerId } from "@comprafino/core";
import type { createDatabase } from "./client.ts";

type Database = ReturnType<typeof createDatabase>;

export async function registerCatalogSources(
  db: Database,
  retailer: RetailerId,
  raw: readonly CatalogSource[],
) {
  const sources = z.array(catalogSourceSchema).min(1).max(5000).parse(raw);
  if (sources.some((source) => source.retailer !== retailer)) {
    throw new Error("Mixed catalog source retailers");
  }
  await db.batch([
    db.execute(sql`select id from retailers where id=${retailer} for update`),
    db.execute(sql`insert into catalog_sources(retailer_id,source_key,name,url)
      select retailer,key,name,url from jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) x(retailer text,key text,name text,url text)
      on conflict(retailer_id,source_key) do update set name=excluded.name,url=excluded.url,active=true,
        cursor=case when catalog_sources.url<>excluded.url then 0 else catalog_sources.cursor end,
        cycle_products=case when catalog_sources.url<>excluded.url then 0 else catalog_sources.cycle_products end,
        lease_token=case when catalog_sources.url<>excluded.url then null else catalog_sources.lease_token end,
        lease_until=case when catalog_sources.url<>excluded.url then null else catalog_sources.lease_until end,
        cycle_capacity_skips=case when catalog_sources.url<>excluded.url then 0 else catalog_sources.cycle_capacity_skips end,
        last_completed_at=case when catalog_sources.url<>excluded.url then null else catalog_sources.last_completed_at end,
        next_eligible_at=case when catalog_sources.url<>excluded.url then statement_timestamp() else catalog_sources.next_eligible_at end`),
    db.execute(sql`update catalog_sources set active=false where retailer_id=${retailer}
      and source_key not in(select key from jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) x(key text))`),
  ]);
}

export async function claimCatalogSource(db: Database, retailer: RetailerId) {
  retailerIdSchema.parse(retailer);
  const result = await db.execute(sql`with candidate as (
    select id from catalog_sources where retailer_id=${retailer} and active
      and next_eligible_at<=statement_timestamp() and (lease_until is null or lease_until<=statement_timestamp())
    order by (requested_at is not null and (last_completed_at is null or requested_at>last_completed_at)) desc,
      (last_completed_at is null and regexp_replace(lower(normalize(name,NFD)), '[^[:alnum:]]+', '', 'g')~'higienic|arroz|aceit|atun|deterg|avena|fideo|pasta|harina|azucar|huevo') desc,
      last_attempted_at nulls first,source_key limit 1 for update skip locked
  ) update catalog_sources s set lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes',
    last_attempted_at=statement_timestamp() from candidate c where s.id=c.id
    returning s.id,s.retailer_id as retailer,s.source_key as key,s.name,s.url,s.cursor,s.lease_token as token`);
  return result.rows.length ? catalogSourceClaimSchema.parse(result.rows[0]) : null;
}

/** Advance only after accepted listing persistence. A crash safely replays that page. */
export async function completeCatalogPage(
  db: Database,
  rawClaim: CatalogSourceClaim,
  nextCursor: number | null,
  discovered: number,
  externalIds: readonly string[],
  capacitySkips = 0,
) {
  const claim = catalogSourceClaimSchema.parse(rawClaim);
  z.number().int().nonnegative().nullable().parse(nextCursor);
  z.number().int().nonnegative().parse(discovered);
  z.number().int().nonnegative().parse(capacitySkips);
  if (nextCursor !== null && nextCursor <= claim.cursor) {
    throw new Error("Catalog cursor did not advance");
  }
  const results = await db.batch([
    db.execute(sql`select id from catalog_sources where id=${claim.id} for update`),
    db.execute(sql`insert into catalog_source_listings(source_id,listing_id)
      select ${claim.id}::uuid,l.id from retailer_listings l where l.retailer_id=${claim.retailer}
        and l.external_id in(select jsonb_array_elements_text(${JSON.stringify(externalIds)}::jsonb))
        and exists(select 1 from catalog_sources where id=${claim.id} and lease_token=${claim.token}::uuid)
      on conflict do nothing`),
    db.execute(sql`update catalog_sources set cursor=${nextCursor ?? 0},lease_token=null,lease_until=null,error=null,
      pages_observed=pages_observed+1,products_observed=products_observed+${discovered},
      cycle_products=${nextCursor === null ? sql`0` : sql`cycle_products+${discovered}`},
      last_cycle_products=${nextCursor === null ? sql`cycle_products+${discovered}` : sql`last_cycle_products`},
      last_cycle_capacity_skips=${nextCursor === null ? sql`cycle_capacity_skips+${capacitySkips}` : sql`last_cycle_capacity_skips`},
      cycle_capacity_skips=${nextCursor === null ? sql`0` : sql`cycle_capacity_skips+${capacitySkips}`},
      last_completed_at=${nextCursor === null ? sql`statement_timestamp()` : sql`last_completed_at`},
      next_eligible_at=statement_timestamp()+${nextCursor === null ? sql`case when requested_at>statement_timestamp()-interval '1 day' then interval '4 hours' else interval '20 hours' end` : sql`interval '0 seconds'`}
      where id=${claim.id} and lease_token=${claim.token}::uuid returning id`),
  ]);
  if (!results[2].rows.length) {
    throw new Error("Catalog page lease changed; progress retained for replay");
  }
}

export async function failCatalogPage(db: Database, rawClaim: CatalogSourceClaim) {
  const claim = catalogSourceClaimSchema.parse(rawClaim);
  await db.execute(sql`update catalog_sources set lease_token=null,lease_until=null,
    next_eligible_at=statement_timestamp()+interval '6 hours',error='source_or_persistence_failed'
    where id=${claim.id} and lease_token=${claim.token}::uuid`);
}

export async function requestCatalogRefresh(db: Database, listingIds: readonly string[]) {
  const ids = z.array(z.uuid()).max(50_000).parse(listingIds);
  if (!ids.length) return;
  await db.execute(sql`update catalog_sources s set requested_at=statement_timestamp(),
    next_eligible_at=least(next_eligible_at,coalesce(last_completed_at,statement_timestamp()-interval '4 hours')+interval '4 hours')
    where exists(select 1 from catalog_source_listings link where link.source_id=s.id
      and link.listing_id in(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid))`);
}

export async function inspectCatalogAcquisition(db: Database) {
  const result = (
    await db.execute(sql`select retailer_id, count(*)::int as categories,
    count(*) filter(where cursor>0)::int as in_progress,
    count(*) filter(where last_completed_at is null)::int as never_completed,
    count(*) filter(where next_eligible_at<=statement_timestamp())::int as due,
    count(*) filter(where error is not null)::int as failed,
    count(*) filter(where cycle_capacity_skips>0 or last_cycle_capacity_skips>0)::int as capacity_limited,
    min(last_completed_at) as oldest_cycle,max(last_completed_at) as latest_cycle,
    sum(pages_observed)::bigint::text as pages,sum(products_observed)::bigint::text as products
    from catalog_sources where active group by retailer_id order by retailer_id`)
  ).rows;
  return z
    .array(
      z.object({
        retailer_id: retailerIdSchema,
        categories: z.number().int().nonnegative(),
        in_progress: z.number().int().nonnegative(),
        never_completed: z.number().int().nonnegative(),
        due: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        capacity_limited: z.number().int().nonnegative(),
        oldest_cycle: z.coerce.date().nullable(),
        latest_cycle: z.coerce.date().nullable(),
        pages: z.string().regex(/^\d+$/u),
        products: z.string().regex(/^\d+$/u),
      }),
    )
    .parse(result);
}

export async function inspectCatalogWork(db: Database) {
  const result = await db.execute(sql`select
    (select count(*)::int from retailer_listings l left join listing_normalizations n on n.listing_id=l.id
      where n.listing_id is null or n.input_fingerprint='' or n.normalization_version<>${normalizationVersion}) as normalization,
    (select count(*)::int from listing_normalizations n where n.input_fingerprint<>'' and n.normalization_version=${normalizationVersion}
      and (n.matched_fingerprint is distinct from n.input_fingerprint or n.matched_version is distinct from ${matchingVersion})
      and not exists(select 1 from canonical_product_listings a where a.listing_id=n.listing_id and a.method='manual')) as matching`);
  return z
    .object({
      normalization: z.number().int().nonnegative(),
      matching: z.number().int().nonnegative(),
    })
    .parse(result.rows[0]);
}
