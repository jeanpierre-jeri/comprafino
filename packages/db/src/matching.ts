import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  canonicalGroups,
  comparisonTitle,
  generateCandidates,
  hardConflicts,
  matchingVersion,
  normalizationVersion,
  normalizeCatalogListing,
  scoreMatch,
} from "@comprafino/core";
import type { MatchingListing, MatchPair } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { catalogFingerprint, catalogRecord } from "./catalog.ts";
import {
  canonicalProducts,
  canonicalProductListings,
  listingNormalizations,
  retailerListings,
} from "./schema.ts";

type Database = ReturnType<typeof createDatabase>;

export type MatchingSnapshot = MatchingListing & {
  rawSnapshot: string;
  normalizedSnapshot: string;
  priorGroupId?: string | null;
};

export async function readMatchingSample(db: Database, limit: number): Promise<MatchingSnapshot[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error("Invalid limit");
  }

  const records = await db
    .select({
      listing: retailerListings,
      normalization: listingNormalizations,
      rawSnapshot: sql<string>`to_jsonb(retailer_listings)::text`,
      normalizedSnapshot: sql<string>`to_jsonb(listing_normalizations)::text`,
      priorGroupId: canonicalProductListings.canonicalProductId,
    })
    .from(retailerListings)
    .innerJoin(listingNormalizations, eq(retailerListings.id, listingNormalizations.listingId))
    .leftJoin(canonicalProductListings, eq(retailerListings.id, canonicalProductListings.listingId))
    .where(eq(retailerListings.active, true))
    .orderBy(asc(retailerListings.retailerId), asc(retailerListings.externalId))
    .limit(limit);

  return records.map((row) => {
    const input = catalogRecord(row.listing);

    if (
      row.normalization.inputFingerprint !== catalogFingerprint(input) ||
      row.normalization.normalizationVersion !== normalizationVersion
    ) {
      throw new Error("Stale normalization; normalize selected catalog first");
    }

    const a = normalizeCatalogListing(input);

    // Verify stored derived values too; unpublished normalization corrections must be persisted first.
    if (
      JSON.stringify([
        a.normalizedTitle,
        a.brandKey,
        a.quantity?.value ?? null,
        a.quantity?.unit ?? null,
        a.packageCount,
        a.totalQuantity?.value ?? null,
        a.issues,
      ]) !==
      JSON.stringify([
        row.normalization.normalizedTitle,
        row.normalization.brandKey,
        row.normalization.quantityValue,
        row.normalization.quantityUnit,
        row.normalization.packageCount,
        row.normalization.totalQuantityValue,
        row.normalization.issues,
      ])
    ) {
      throw new Error("Derived values differ; normalize first");
    }

    return {
      priorGroupId: row.priorGroupId,
      id: input.id,
      retailer: input.retailerId,
      title: input.title,
      attributes: a,
      rawSnapshot: z.string().parse(row.rawSnapshot),
      normalizedSnapshot: z.string().parse(row.normalizedSnapshot),
    };
  });
}

export async function evaluatePairs(
  db: Database,
  pairs: readonly (readonly [MatchingListing, MatchingListing])[],
): Promise<MatchPair[]> {
  if (!pairs.length) return [];

  const compatibility = pairs.map(([a, b]) => hardConflicts(a, b));
  const payload = JSON.stringify(
    pairs.map(([a, b]) => ({ a: a.id, b: b.id, ta: comparisonTitle(a), tb: comparisonTitle(b) })),
  );
  const result = await db.execute(
    sql`select x.a,x.b,public.similarity(x.ta,x.tb)::float8 as similarity from jsonb_to_recordset(${payload}::jsonb) x(a text,b text,ta text,tb text)`,
  );
  const similarities = z
    .array(z.object({ a: z.string(), b: z.string(), similarity: z.number().min(0).max(1) }))
    .parse(result.rows);
  const indexed = new Map(similarities.map((r) => [`${r.a}|${r.b}`, r.similarity]));

  return pairs.map(([a, b], index) => ({
    a: a.id,
    b: b.id,
    result: compatibility[index]!.length
      ? {
          score: 0,
          decision: "incompatible",
          reasons: compatibility[index]!,
          similarity: indexed.get(`${a.id}|${b.id}`)!,
        }
      : scoreMatch(a, b, indexed.get(`${a.id}|${b.id}`)!),
  }));
}

export function canonicalGroupId(ids: readonly string[]): string {
  const hash = createHash("sha256")
    .update(`comprafino:canonical:${[...ids].sort().join("|")}`)
    .digest("hex")
    .slice(0, 32);

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${"8" + hash.slice(13, 16)}-${((Number.parseInt(hash[16]!, 16) & 3) | 8).toString(16) + hash.slice(17, 20)}-${hash.slice(20)}`;
}

export function matchingPersistenceStatements(
  rows: readonly MatchingSnapshot[],
  pairs: readonly MatchPair[],
  priorGroupIds: readonly string[] = [],
) {
  if (new Set(rows.map((r) => r.id)).size !== rows.length) {
    throw new Error("Duplicate matching listing");
  }

  const groups = canonicalGroups(rows, pairs);
  const products = groups.map((ids) => {
    const members = ids.map((id) => rows.find((r) => r.id === id)!);
    const representative = [...members].sort(
      (a, b) => a.title.length - b.title.length || a.id.localeCompare(b.id),
    )[0]!;
    const a = representative.attributes;

    return {
      id: canonicalGroupId(ids),
      display_name: representative.title,
      brand_key: a.brandKey,
      quantity_value: a.quantity!.value,
      quantity_unit: a.quantity!.unit,
      package_count: a.packageCount,
      total_quantity_value: a.totalQuantity!.value,
    };
  });
  const links = groups.flatMap((ids) =>
    ids.map((id) => {
      const supporting = pairs.filter(
        (p) => ids.includes(p.a) && ids.includes(p.b) && (p.a === id || p.b === id),
      );

      return {
        listing_id: id,
        canonical_product_id: canonicalGroupId(ids),
        retailer_id: rows.find((r) => r.id === id)!.retailer,
        confidence: Math.min(...supporting.map((p) => p.result.score)),
        matching_version: matchingVersion,
        method: "automatic",
        reasons: [...new Set(supporting.flatMap((p) => p.result.reasons))].sort(),
      };
    }),
  );
  const snapshot = JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      raw: JSON.parse(r.rawSnapshot) as unknown,
      normalized: JSON.parse(r.normalizedSnapshot) as unknown,
    })),
  );
  const productJson = JSON.stringify(products),
    linkJson = JSON.stringify(links);
  const selected = sql`select x.id from jsonb_to_recordset(${snapshot}::jsonb) x(id uuid,raw jsonb,normalized jsonb)`;
  // Every mutation uses the same guard under shared retailer locks. A scope cannot split
  // an existing group, replace manual decisions, or assign stale raw/normalized inputs.
  const guard = sql`not exists(select 1 from jsonb_to_recordset(${snapshot}::jsonb) x(id uuid,raw jsonb,normalized jsonb)
    left join retailer_listings l on l.id=x.id left join listing_normalizations n on n.listing_id=x.id
    where to_jsonb(l) is distinct from x.raw or to_jsonb(n) is distinct from x.normalized)
    and not exists(select 1 from canonical_product_listings c where c.listing_id in (${selected}) and
      (c.method='manual' or exists(select 1 from canonical_product_listings other where other.canonical_product_id=c.canonical_product_id and other.listing_id not in (${selected}))))`;
  const desiredLinks = sql`select * from jsonb_to_recordset(${linkJson}::jsonb) x(listing_id uuid,canonical_product_id uuid,retailer_id text,confidence numeric,matching_version integer,method text,reasons text[])`;
  const desiredProducts = sql`select * from jsonb_to_recordset(${productJson}::jsonb) x(id uuid,display_name text,brand_key text,quantity_value integer,quantity_unit text,package_count integer,total_quantity_value integer)`;

  return [
    sql`select id from retailers order by id for update`,
    sql`select (${guard}) as eligible`,
    sql`delete from canonical_product_listings c where (${guard}) and c.method='automatic' and c.listing_id in (${selected}) and not exists
      (select 1 from (${desiredLinks}) d where (c.listing_id,c.canonical_product_id,c.retailer_id,c.confidence,c.matching_version,c.method,c.reasons) is not distinct from (d.listing_id,d.canonical_product_id,d.retailer_id,d.confidence,d.matching_version,d.method,d.reasons)) returning c.listing_id`,
    sql`insert into canonical_products(id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value)
      select id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value from (${desiredProducts}) d where (${guard})
      on conflict(id) do update set display_name=excluded.display_name,brand_key=excluded.brand_key,
        quantity_value=excluded.quantity_value,quantity_unit=excluded.quantity_unit,package_count=excluded.package_count,total_quantity_value=excluded.total_quantity_value
      where (canonical_products.display_name,canonical_products.brand_key,canonical_products.quantity_value,canonical_products.quantity_unit,canonical_products.package_count,canonical_products.total_quantity_value)
      is distinct from (excluded.display_name,excluded.brand_key,excluded.quantity_value,excluded.quantity_unit,excluded.package_count,excluded.total_quantity_value)
      returning id,(xmax=0) as inserted`,
    sql`insert into canonical_product_listings(listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons)
      select listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons from (${desiredLinks}) d where (${guard})
      on conflict(listing_id) do nothing returning listing_id`,
    // Delete only derived orphan groups this sample used to own; leave unrelated products alone.
    sql`delete from canonical_products p where (${guard}) and not exists(select 1 from canonical_product_listings c where c.canonical_product_id=p.id)
      and p.id in (select jsonb_array_elements_text(${JSON.stringify(priorGroupIds)}::jsonb)::uuid) returning id`,
  ] as const;
}

export async function persistMatching(
  db: Database,
  rows: readonly MatchingSnapshot[],
  pairs: readonly MatchPair[],
) {
  if (!rows.length) {
    return {
      productsCreated: 0,
      productsUpdated: 0,
      linksCreated: 0,
      linksRemoved: 0,
      productsRemoved: 0,
      stale: false,
    };
  }

  const s = matchingPersistenceStatements(
    rows,
    pairs,
    rows.flatMap((r) => (r.priorGroupId ? [r.priorGroupId] : [])),
  );
  const r = await db.batch([
    db.execute(s[0]),
    db.execute(s[1]),
    db.execute(s[2]),
    db.execute(s[3]),
    db.execute(s[4]),
    db.execute(s[5]),
  ]);
  const [{ eligible }] = z.tuple([z.object({ eligible: z.boolean() })]).parse(r[1].rows);
  const productWrites = z.array(z.object({ id: z.uuid(), inserted: z.boolean() })).parse(r[3].rows);

  return {
    productsCreated: productWrites.filter((p) => p.inserted).length,
    productsUpdated: productWrites.filter((p) => !p.inserted).length,
    linksCreated: r[4].rows.length,
    linksRemoved: r[2].rows.length,
    productsRemoved: r[5].rows.length,
    stale: !eligible,
  };
}

export async function matchCatalog(db: Database, limit = 100, dryRun = false) {
  const rows = await readMatchingSample(db, limit);
  const pairs = await evaluatePairs(db, generateCandidates(rows));
  const groups = canonicalGroups(rows, pairs);
  const persisted = dryRun ? null : await persistMatching(db, rows, pairs);

  return {
    version: matchingVersion,
    rows,
    pairs,
    groups,
    persisted,
    metrics: {
      normalizedListings: rows.length,
      candidatePairs: pairs.length,
      autoMatches: pairs.filter((p) => p.result.decision === "auto_match").length,
      review: pairs.filter((p) => p.result.decision === "review").length,
      incompatible: pairs.filter((p) => p.result.decision === "incompatible").length,
      noMatch: pairs.filter((p) => p.result.decision === "no_match").length,
      crossRetailerGroups: groups.length,
      twoRetailerGroups: groups.filter((g) => g.length === 2).length,
      threeRetailerGroups: groups.filter((g) => g.length === 3).length,
    },
  };
}

export async function inspectMatching(db = createDatabase()) {
  const evaluation = await matchCatalog(db, 150, true);
  const links = await db
    .select({ link: canonicalProductListings, product: canonicalProducts })
    .from(canonicalProductListings)
    .innerJoin(
      canonicalProducts,
      eq(canonicalProductListings.canonicalProductId, canonicalProducts.id),
    )
    .orderBy(asc(canonicalProductListings.canonicalProductId))
    .limit(150);

  return { ...evaluation, links };
}
