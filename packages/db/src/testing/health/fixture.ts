import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { normalizationVersion, retailerIdSchema } from "@comprafino/core";
import { z } from "zod";
import { catalogFingerprint } from "../../catalog.ts";
import * as tables from "../../schema.ts";
import { createTestQueryClient, validateLocalTestUrl } from "../test-query-client.ts";
import { testSchemaClient } from "../test-schema-client.ts";

export const healthFixtureNow = new Date("2026-10-28T12:00:00.000Z");

const templates = [
  { title: "Arroz Costeño Bolsa 1Kg", sourceBrand: "Costeño", category: "444" },
  { title: "Leche Gloria Entera 1L", sourceBrand: "Gloria", category: null },
  { title: "Huevos La Calera Bandeja 15 Unidades", sourceBrand: "La Calera", category: "150" },
  { title: "Pollo Fresco por Kg", sourceBrand: null, category: null, priceUnit: "KG" },
  { title: "Atún en aceite 170g", sourceBrand: null, category: null },
  { title: "Producto sin cantidad", sourceBrand: null, category: null },
  { title: "Papel Higiénico Suave 4 Rollos", sourceBrand: "Suave", category: null },
  { title: "Harina de Arroz Costeño 1 g", sourceBrand: "Costeño", category: null },
] as const;

const hosts = [
  "www.tottus.com.pe",
  "www.plazavea.com.pe",
  "www.metro.pe",
  "www.makro.plazavea.com.pe",
];

/** Minimal typed read fixtures, not an application schema or migration runner.
 * Both readers use these same tables. All objects belong to a fresh random schema. */
export function healthFixture(env: Record<string, string | undefined>) {
  if (env.COMPRAFINO_TEST_DATABASE_MODE !== "local" || !env.TEST_DATABASE_URL) {
    throw new Error("Health fixtures require explicit local TEST_DATABASE_URL and local mode");
  }
  const url = validateLocalTestUrl(env.TEST_DATABASE_URL);
  const client = createTestQueryClient(url, "local");
  const schema = `comprafino_test_${randomUUID().replaceAll("-", "")}`;
  const scoped = testSchemaClient(client, schema);
  const db = drizzle(scoped, { schema: tables });
  let owned = false;

  async function dispose() {
    if (owned) {
      await client.query(`drop schema "${schema}" cascade`);
      owned = false;
    }
    const rows = z
      .array(z.object({ present: z.boolean() }))
      .parse(
        await client.query(
          "select exists(select 1 from pg_namespace where nspname=$1) as present",
          [schema],
        ),
      );
    if (rows[0]?.present) {
      throw new Error("Health fixture schema was not removed");
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
        throw new Error("Health fixture schema isolation failed");
      }
      await scoped.transaction([
        scoped.query("create table retailers(id text primary key,name text not null)"),
        scoped.query(`create table retailer_listings(
          id uuid primary key,retailer_id text not null references retailers(id),title text not null,
          price_unit text not null,package_text text,source_brand text,source_unit_multiplier numeric,
          category text,url text not null,last_seen_at timestamptz not null,
          available boolean,active boolean not null)`),
        scoped.query(`create table listing_normalizations(
          listing_id uuid primary key references retailer_listings(id),
          input_fingerprint text not null,normalization_version integer not null)`),
        scoped.query(`create table price_history(
          listing_id uuid references retailer_listings(id),current_price_cents integer not null,
          regular_price_cents integer,currency text not null,price_unit text not null,valid_until timestamptz)`),
        scoped.query(
          "create unique index one_current_price_state on price_history(listing_id) where valid_until is null",
        ),
        scoped.query(`create table ingestion_runs(
          id uuid primary key,retailer_id text not null references retailers(id),
          started_at timestamptz not null,ended_at timestamptz,status text not null,
          listings_fetched integer not null,listings_persisted integer not null,
          listings_changed integer not null,error text)`),
      ]);
      await scoped.query(
        "insert into retailers select * from jsonb_to_recordset($1::jsonb) x(id text,name text)",
        [JSON.stringify(retailerIdSchema.options.map((id) => ({ id, name: id })))],
      );
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  async function seed(size: number) {
    if (!owned || !Number.isSafeInteger(size) || size < 0 || size > 50_001) {
      throw new Error("Invalid owned health fixture size");
    }
    await scoped.query(
      "truncate retailer_listings,listing_normalizations,price_history,ingestion_runs",
    );
    await scoped.query("update retailers set name=id");
    const inputs = templates.map((template) => {
      const input = {
        ...template,
        priceUnit: "priceUnit" in template ? template.priceUnit : ("UN" as const),
        packageText: null,
        sourceUnitMultiplier: null,
      };
      return { ...input, fingerprint: catalogFingerprint(input) };
    });
    await scoped.query(
      `with seeds as (
      select value,ordinality from jsonb_array_elements($1::jsonb) with ordinality
    ) insert into retailer_listings
      select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,r.id,s.value->>'title',s.value->>'priceUnit',null,
        s.value->>'sourceBrand',null,s.value->>'category','https://' || ($3::text[])[1+(i-1)%4] || '/producto-sintetico/p',
        $4::timestamptz,case when i%3=0 then null else true end,true
      from generate_series(1,$2::int) i
      join seeds s on s.ordinality=1+(i-1)%8
      join unnest($5::text[]) with ordinality r(id,position) on r.position=1+(i-1)%4`,
      [
        JSON.stringify(inputs),
        size,
        hosts,
        healthFixtureNow.toISOString(),
        retailerIdSchema.options,
      ],
    );
    await scoped.query(
      `insert into listing_normalizations
      select l.id,s.fingerprint,$2 from retailer_listings l
      join jsonb_to_recordset($1::jsonb) s(title text,fingerprint text) on s.title=l.title`,
      [JSON.stringify(inputs), normalizationVersion],
    );
    await scoped.query(`insert into price_history
      select id,1299,1599,'PEN',price_unit,null from retailer_listings`);
    await scoped.query(
      `insert into ingestion_runs
      select ('20000000-0000-4000-8000-'||lpad(row_number() over(order by id)::text,12,'0'))::uuid,id,$1::timestamptz-interval '12 hours',
        $1::timestamptz-interval '11 hours','success',10,10,0,null from retailers`,
      [healthFixtureNow.toISOString()],
    );
    await scoped.query("analyze retailer_listings");
    await scoped.query("analyze listing_normalizations");
    await scoped.query("analyze price_history");
  }

  return { db, scoped, setup, seed, dispose };
}
