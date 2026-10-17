import { generateCandidates, normalizeCatalogListing, retailerIdSchema } from "@comprafino/core";
import type { NormalizedRetailerListing } from "@comprafino/core";
import { z } from "zod";
import { persistListings } from "../ingestion.ts";
import {
  catalogFingerprint,
  catalogRecordSchema,
  persistCatalogNormalizations,
} from "../catalog.ts";
import { evaluatePairs, persistMatching, readMatchingSample } from "../matching.ts";
import type { ownedTestDatabase } from "./database.ts";

type Harness = Pick<ReturnType<typeof ownedTestDatabase>, "db" | "scoped">;

// Twenty distinct identity templates, four stores, repeated in complete blocks.
// Repetition measures reader volume, not ingestion throughput or lexical diversity.
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

const hosts = {
  metro: "www.metro.pe",
  tottus: "www.tottus.com.pe",
  "plaza-vea": "www.plazavea.com.pe",
  makro: "www.makro.plazavea.com.pe",
};

export async function seedCatalogBenchmark(harness: Harness, now: Date) {
  const { db, scoped } = harness;
  // All 36 observations, price transitions, benefits and normalizations use writers.
  for (let day = 35; day >= 0; day--) {
    const observedAt = new Date(now.getTime() - day * 86_400_000 - 60_000);
    for (const [storeIndex, retailer] of retailerIdSchema.options.entries()) {
      const listings: NormalizedRetailerListing[] = templates.map(([title, category], index) => {
        const currentPriceCents = 400 + index * 151 + storeIndex * 29 + (day % 7) * 10;
        let available = storeIndex % 2 ? true : undefined;
        if (index === 19 && storeIndex === 0) {
          available = false;
        }
        return {
          retailer,
          externalId: `scale-template-${index}`,
          productId: `scale-template-${index}`,
          title,
          sourceBrand: "Benchcatalogo",
          category,
          url: `https://${hosts[retailer]}/benchmark/p`,
          currentPriceCents,
          regularPriceCents: currentPriceCents + 300,
          currency: "PEN",
          priceUnit: index === 17 ? "KG" : "UN",
          // Keep true/false/unknown distinct, including one unavailable store/template.
          available,
          observedAt,
          conditionalOffers:
            retailer === "tottus" && index % 2 === 0
              ? [
                  {
                    programKey: "cmr",
                    conditionType: "payment_card",
                    conditionLabel: "Requiere tarjeta CMR",
                    priceCents: currentPriceCents - 100,
                    observedAt,
                  },
                ]
              : [],
        };
      });
      await persistListings(db, retailer, listings);
    }
  }
  const records = z.array(catalogRecordSchema).parse(
    await scoped.query(`select id,retailer_id as "retailerId",title,price_unit as "priceUnit",
    source_brand as "sourceBrand",package_text as "packageText",source_unit_multiplier::float8 as "sourceUnitMultiplier" from retailer_listings`),
  );
  await persistCatalogNormalizations(db, records);
  const snapshots = await readMatchingSample(db, 80);
  await persistMatching(db, snapshots, await evaluatePairs(db, generateCandidates(snapshots)));
  // Controlled time travel only: these unchanged identities are assumed linked at
  // the first observation, so the real temporal reader can exercise 28 past days.
  await scoped.query("update canonical_product_listings set linked_at=$1::timestamptz", [
    new Date(now.getTime() - 35 * 86_400_000 - 60_000).toISOString(),
  ]);
  await scoped.query(
    `insert into catalog_sources(retailer_id,source_key,name,url)
    select distinct retailer_id,category,category,'https://' || $1 || '/benchmark' from retailer_listings`,
    [hosts.metro],
  );
  await scoped.query(`insert into catalog_source_listings(source_id,listing_id)
    select s.id,l.id from catalog_sources s join retailer_listings l on l.retailer_id=s.retailer_id and l.category=s.source_key`);
  // Immutable source tables isolate templates from later volume expansion.
  for (const table of [
    "retailer_listings",
    "listing_normalizations",
    "canonical_products",
    "canonical_product_listings",
    "price_history",
    "listing_observation_days",
    "retailer_listing_offers",
    "catalog_source_listings",
  ]) {
    await scoped.query(`create table benchmark_seed_${table} as table ${table}`);
  }
  return {
    templateListings: records.length,
    knownQuantityTemplates: records.filter((r) => normalizeCatalogListing(r).totalQuantity).length,
  };
}

export async function growCatalogBenchmark(
  { scoped }: Harness,
  previousSize: number,
  size: number,
) {
  if (previousSize < 80 || previousSize % 80 || size % 80 || size < previousSize || size > 50_000) {
    throw new Error("Benchmark sizes must be complete 80-listing blocks within retained capacity");
  }
  await scoped.query(
    "create table if not exists benchmark_listing_map(id uuid primary key,template_id uuid,cycle integer)",
  );
  await scoped.query(
    "create table if not exists benchmark_group_map(id uuid primary key,template_id uuid,cycle integer)",
  );
  await scoped.query("truncate benchmark_listing_map,benchmark_group_map");
  const range = [previousSize / 80, size / 80 - 1];
  await scoped.query(
    `insert into benchmark_listing_map select gen_random_uuid(),t.id,g.i from benchmark_seed_retailer_listings t cross join generate_series($1::int,$2::int) g(i)`,
    range,
  );
  await scoped.query(
    `insert into benchmark_group_map select gen_random_uuid(),t.id,g.i from benchmark_seed_canonical_products t cross join generate_series($1::int,$2::int) g(i)`,
    range,
  );
  await scoped.query(`insert into retailer_listings select (jsonb_populate_record(null::retailer_listings,to_jsonb(t)||jsonb_build_object(
    'id',m.id,'external_id',t.external_id||'-copy-'||m.cycle,'product_id',t.product_id||'-copy-'||m.cycle))).*
    from benchmark_listing_map m join benchmark_seed_retailer_listings t on t.id=m.template_id`);
  await scoped.query(`insert into canonical_products select (jsonb_populate_record(null::canonical_products,to_jsonb(t)||jsonb_build_object('id',m.id))).*
    from benchmark_group_map m join benchmark_seed_canonical_products t on t.id=m.template_id`);
  await scoped.query(`insert into canonical_product_listings select (jsonb_populate_record(null::canonical_product_listings,to_jsonb(t)||jsonb_build_object('listing_id',l.id,'canonical_product_id',g.id))).*
    from benchmark_listing_map l join benchmark_seed_canonical_product_listings t on t.listing_id=l.template_id
    join benchmark_group_map g on g.template_id=t.canonical_product_id and g.cycle=l.cycle`);
  for (const table of [
    "listing_normalizations",
    "listing_observation_days",
    "retailer_listing_offers",
    "catalog_source_listings",
  ]) {
    await scoped.query(`insert into ${table} select (jsonb_populate_record(null::${table},to_jsonb(t)||jsonb_build_object('listing_id',m.id))).*
      from benchmark_listing_map m join benchmark_seed_${table} t on t.listing_id=m.template_id`);
  }
  await scoped.query(`insert into price_history select (jsonb_populate_record(null::price_history,to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),'listing_id',m.id))).*
    from benchmark_listing_map m join benchmark_seed_price_history t on t.listing_id=m.template_id`);
  await scoped.query(
    "analyze retailer_listings,listing_normalizations,price_history,canonical_products,canonical_product_listings,listing_observation_days,retailer_listing_offers,catalog_source_listings,catalog_sources,retailers",
  );
  // Validate every clone's fingerprint, not only row counts or a sample.
  const records = z
    .array(z.object({ listing: catalogRecordSchema, fingerprint: z.string() }))
    .parse(
      await scoped.query(`select jsonb_build_object(
    'id',l.id,'retailerId',l.retailer_id,'title',l.title,'priceUnit',l.price_unit,'sourceBrand',l.source_brand,
    'packageText',l.package_text,'sourceUnitMultiplier',l.source_unit_multiplier::float8) as listing,n.input_fingerprint as fingerprint
    from retailer_listings l join listing_normalizations n on n.listing_id=l.id`),
    );
  if (
    records.length !== size ||
    records.some((r) => catalogFingerprint(r.listing) !== r.fingerprint)
  ) {
    throw new Error("Benchmark clone count/fingerprint mismatch");
  }
  const counts = await scoped.query(`select
    (select count(*)::int from retailer_listings) as listings,
    (select count(*)::int from canonical_products) as exact_groups,
    (select count(*)::int from canonical_product_listings) as exact_links,
    (select count(*)::int from price_history) as price_states,
    (select count(*)::int from listing_observation_days) as observation_days,
    (select count(*)::int from retailer_listing_offers) as benefits,
    (select count(*)::int from listing_normalizations where total_quantity_value is null) as missing_package_quantity,
    (select jsonb_object_agg(state,n) from (select coalesce(available::text,'unknown') state,count(*) n from retailer_listings group by available) a) as availability,
    (select jsonb_object_agg(retailer_id,n) from (select retailer_id,count(*) n from retailer_listings group by retailer_id) a) as stores`);
  const groups = z
    .array(z.object({ id: z.uuid() }))
    .parse(
      await scoped.query(
        "select id from (select id,display_name,row_number() over(partition by display_name order by id) as position from canonical_products) g order by position,display_name limit 50",
      ),
    );
  if (groups.length < 50) {
    throw new Error("Benchmark needs 50 exact groups");
  }
  return { counts: counts[0], exactIds: groups.map((g) => g.id) };
}
