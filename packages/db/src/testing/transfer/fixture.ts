import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { z } from "zod";
import {
  matchingVersion,
  normalizationVersion,
  normalizeCatalogListing,
  normalizeSearchQuery,
  retailerIdSchema,
} from "@comprafino/core";
import { catalogFingerprint } from "../../catalog.ts";
import * as tables from "../../schema.ts";
import { createTestQueryClient, validateLocalTestUrl } from "../test-query-client.ts";
import { testSchemaClient } from "../test-schema-client.ts";

export const transferNow = new Date("2026-10-28T18:00:00.000Z");

export function transferId(kind: number, index: number) {
  return `${kind}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const templates = [
  ["Arroz Benchcatalogo Blanco Bolsa 1kg", "Abarrotes / Arroz"],
  ["Arroz Benchcatalogo Integral Bolsa 5kg", "Abarrotes / Arroz"],
  ["Aceite Benchcatalogo Vegetal Botella 1L", "Abarrotes / Aceites"],
  ["Aceite Benchcatalogo Oliva Botella 500ml", "Abarrotes / Aceites"],
  ["Huevos Benchcatalogo Pardos Bandeja 30un", "Lácteos y Huevos / Huevos"],
  ["Huevos Benchcatalogo Blancos Bandeja 15un", "Lácteos y Huevos / Huevos"],
  ["Leche Benchcatalogo Entera Caja 1L", "Lácteos y Huevos / Leches"],
  ["Leche Benchcatalogo Descremada Caja 946ml", "Lácteos y Huevos / Leches"],
  ["Detergente Benchcatalogo Polvo Bolsa 1kg", "Limpieza / Detergentes"],
  ["Detergente Benchcatalogo Líquido Botella 2L", "Limpieza / Detergentes"],
  ["Papel Higiénico Benchcatalogo Paquete 4 rollos", "Limpieza / Papeles"],
  ["Agua Benchcatalogo Botella 3L", "Bebidas / Agua"],
  ["Champú Benchcatalogo Frasco 400ml", "Cuidado Personal y Salud / Cabello"],
  ["Fideos Benchcatalogo Benchselect Bolsa 500g", "Abarrotes / Pastas"],
  ["Arroz Benchcatalogo Blanco Bolsa", "Abarrotes / Arroz"],
  ["Huevos Benchcatalogo Pardos Bandeja", "Lácteos y Huevos / Huevos"],
  ["Detergente Benchcatalogo Polvo Bolsa", "Limpieza / Detergentes"],
  ["Pollo Benchcatalogo Fresco", "Carnes / Pollo"],
  ["Yogurt Benchcatalogo Natural Botella 1L", "Lácteos y Huevos / Yogures"],
  ["Galletas Benchcatalogo Vainilla Paquete 200g", "Abarrotes / Galletas"],
] as const;

/** Read fixtures only: explicit local target, owned schema, no migration runner.
 * Minimal types/indexes exercise the actual readers, not ingestion throughput. */
export function transferFixture(env: Record<string, string | undefined>) {
  if (!env.TEST_DATABASE_URL || env.COMPRAFINO_TEST_DATABASE_MODE !== "local") {
    throw new Error("Transfer fixtures require explicit local TEST_DATABASE_URL and mode");
  }
  const client = createTestQueryClient(validateLocalTestUrl(env.TEST_DATABASE_URL), "local");
  const schema = `comprafino_test_${randomUUID().replaceAll("-", "")}`;
  const scoped = testSchemaClient(client, schema);
  const db = drizzle(scoped, { schema: tables });
  let owned = false;

  async function dispose() {
    if (owned) {
      await client.query(`drop schema "${schema}" cascade`);
      owned = false;
    }
    const result = z
      .array(z.object({ present: z.boolean() }))
      .parse(
        await client.query(
          "select exists(select 1 from pg_namespace where nspname=$1) as present",
          [schema],
        ),
      );
    if (result[0]?.present) {
      throw new Error("Transfer fixture cleanup failed");
    }
  }

  async function setup() {
    try {
      await client.query(`create schema "${schema}"`);
      owned = true;
      const current = z
        .array(z.object({ name: z.string() }))
        .parse(await scoped.query("select current_schema() as name"));
      if (current[0]?.name !== schema) {
        throw new Error("Transfer fixture isolation failed");
      }
      const statements = [
        "create table retailers(id text primary key,name text not null)",
        `create table retailer_listings(id uuid primary key,retailer_id text not null references retailers(id),
          title text not null,price_unit text not null,package_text text,source_brand text,source_unit_multiplier numeric,
          category text,url text not null,image_url text,last_seen_at timestamptz not null,available boolean,active boolean not null)`,
        `create table listing_normalizations(listing_id uuid primary key references retailer_listings(id),
          input_fingerprint text not null,normalization_version integer not null,normalized_title text not null,
          brand text,search_identity text not null)`,
        `create table price_history(id uuid primary key,listing_id uuid not null references retailer_listings(id),
          current_price_cents integer not null,regular_price_cents integer,currency text not null,
          price_unit text not null,valid_from timestamptz not null,valid_until timestamptz)`,
        "create unique index transfer_current_price on price_history(listing_id) where valid_until is null",
        "create index transfer_history_lookup on price_history(listing_id,valid_from,valid_until)",
        "create table canonical_products(id uuid primary key,display_name text not null)",
        `create table canonical_product_listings(listing_id uuid primary key references retailer_listings(id),
          canonical_product_id uuid not null references canonical_products(id),retailer_id text not null,
          method text not null,matching_version integer not null,confidence numeric not null,linked_at timestamptz not null)`,
        "create index transfer_group_lookup on canonical_product_listings(canonical_product_id)",
        `create table retailer_listing_offers(listing_id uuid references retailer_listings(id),program_key text,
          condition_type text not null,condition_label text not null,price_cents integer not null,
          starts_at timestamptz,ends_at timestamptz,primary key(listing_id,program_key))`,
        "create table catalog_sources(id integer primary key,name text not null,active boolean not null)",
        `create table catalog_source_listings(listing_id uuid references retailer_listings(id),
          source_id integer references catalog_sources(id),primary key(listing_id,source_id))`,
        `create table listing_observation_days(listing_id uuid references retailer_listings(id),observation_date date,
          first_observed_at timestamptz not null,last_observed_at timestamptz not null,primary key(listing_id,observation_date))`,
      ];
      await scoped.transaction(statements.map((statement) => scoped.query(statement)));
      await scoped.query(
        "insert into retailers select value,value from jsonb_array_elements_text($1::jsonb)",
        [JSON.stringify(retailerIdSchema.options)],
      );
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  async function seed(size: number) {
    if (!owned || !Number.isSafeInteger(size) || size < 0 || size > 50_001) {
      throw new Error("Invalid owned transfer fixture size");
    }
    await scoped.query(`truncate retailer_listings,listing_normalizations,price_history,canonical_products,
      canonical_product_listings,retailer_listing_offers,catalog_sources,catalog_source_listings,listing_observation_days`);
    await scoped.query("update retailers set name=id");
    const inputs = templates.map(([title, category], index) => {
      const record = {
        title,
        category,
        priceUnit: index === 17 ? ("KG" as const) : ("UN" as const),
        sourceBrand: "Benchcatalogo",
        packageText: index === 7 ? "Caja" : null,
        sourceUnitMultiplier: index === 7 ? 1.25 : null,
      };
      const normalized = normalizeCatalogListing(record);
      return {
        ...record,
        fingerprint: catalogFingerprint(record),
        normalizedTitle: normalized.normalizedTitle,
        brand: normalized.brand,
        searchIdentity: normalizeSearchQuery(
          `${normalized.normalizedTitle} ${normalized.brand ?? ""}`,
        ),
      };
    });
    const payload = JSON.stringify(inputs);
    await scoped.query(
      `with seeds as (select value,ordinality from jsonb_array_elements($1::jsonb) with ordinality)
      insert into retailer_listings select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      ($3::text[])[1+(i-1)%4],s.value->>'title',s.value->>'priceUnit',s.value->>'packageText',s.value->>'sourceBrand',
      (s.value->>'sourceUnitMultiplier')::numeric,s.value->>'category',
      'https://' || ($4::text[])[1+(i-1)%4] || '/producto-sintetico-'||i||'/p',
      case when i%3=0 then null else 'https://plazavea.vteximg.com.br/arquivos/ids/12345/fixture.jpg' end,
      $5::timestamptz,case when i%3=0 then null else true end,true
      from generate_series(1,$2::int) i join seeds s on s.ordinality=1+((i-1)/4)%20`,
      [
        payload,
        size,
        retailerIdSchema.options,
        ["www.tottus.com.pe", "www.plazavea.com.pe", "www.metro.pe", "www.makro.plazavea.com.pe"],
        transferNow.toISOString(),
      ],
    );
    await scoped.query(
      `insert into listing_normalizations select l.id,s.fingerprint,$2,s."normalizedTitle",s.brand,s."searchIdentity"
      from retailer_listings l join jsonb_to_recordset($1::jsonb)
      s(title text,fingerprint text,"normalizedTitle" text,brand text,"searchIdentity" text) on s.title=l.title`,
      [payload, normalizationVersion],
    );
    await scoped.query(`insert into canonical_products
      select ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,min(title)
      from (select *,1+(right(id::text,12)::int-1)/4 g from retailer_listings) l
      where (g-1)%20<14 group by g`);
    await scoped.query(
      `insert into canonical_product_listings select l.id,c.id,l.retailer_id,'automatic',$1,1,$2::timestamptz-interval '100 days'
      from retailer_listings l join canonical_products c on c.id=('20000000-0000-4000-8000-'||lpad((1+(right(l.id::text,12)::int-1)/4)::text,12,'0'))::uuid`,
      [matchingVersion, transferNow.toISOString()],
    );
    // First 320 SKUs have 90 recorded days and daily ordinary price transitions.
    // Other SKUs have only a current state: do not fabricate observed history for them.
    await scoped.query(
      `insert into price_history select
      ('30000000-0000-4000-8000-'||lpad((i*100+d)::text,12,'0'))::uuid,l.id,
      400+((i-1)/4)%20*151+(i-1)%4*29+(d%7)*10,900+((i-1)/4)%20*151,'PEN',l.price_unit,
      $1::timestamptz-interval '6 hours'-d*interval '1 day',
      case when d=0 then null else $1::timestamptz-interval '6 hours'-(d-1)*interval '1 day' end
      from (select *,right(id::text,12)::int i from retailer_listings) l
      cross join lateral generate_series(0,case when i<=320 then 89 else 0 end) d`,
      [transferNow.toISOString()],
    );
    await scoped.query(
      `insert into listing_observation_days
      select l.id,($1::timestamptz-d*interval '1 day')::date,
      $1::timestamptz-interval '5 hours'-d*interval '1 day',$1::timestamptz-interval '1 hour'-d*interval '1 day'
      from retailer_listings l cross join generate_series(0,89) d where right(l.id::text,12)::int<=320`,
      [transferNow.toISOString()],
    );
    await scoped.query(`insert into retailer_listing_offers select l.id,'cmr','payment_card','Requiere tarjeta CMR',h.current_price_cents-100,
      null,null from retailer_listings l join price_history h on h.listing_id=l.id and h.valid_until is null
      where l.retailer_id='tottus' and ((right(l.id::text,12)::int-1)/4)%2=0`);
    await scoped.query(
      `insert into catalog_sources select ordinality::int,value->>'category',true
      from jsonb_array_elements($1::jsonb) with ordinality`,
      [payload],
    );
    await scoped.query(
      `insert into catalog_source_listings select l.id,1+((right(l.id::text,12)::int-1)/4)%20 from retailer_listings l`,
    );
    await scoped.query(`analyze retailer_listings,listing_normalizations,price_history,canonical_products,
      canonical_product_listings,retailer_listing_offers,catalog_sources,catalog_source_listings,listing_observation_days`);
  }

  async function digest() {
    const result: Record<string, unknown> = {};
    for (const table of [
      "retailer_listings",
      "listing_normalizations",
      "price_history",
      "canonical_products",
      "canonical_product_listings",
      "retailer_listing_offers",
      "catalog_sources",
      "catalog_source_listings",
      "listing_observation_days",
    ]) {
      result[table] = await scoped.query(
        `select count(*)::int as rows,md5(string_agg(value,'' order by value)) as digest from (select to_jsonb(t)::text value from ${table} t) s`,
      );
    }
    return result;
  }

  return { db, scoped, schema, setup, seed, dispose, digest };
}
