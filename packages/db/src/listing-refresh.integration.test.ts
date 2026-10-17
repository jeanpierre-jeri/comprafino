import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { hasTargetedRefreshPath } from "@comprafino/core";
import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import { evaluatePairs, persistMatching } from "./matching.ts";
import {
  claimListingRefresh,
  finishListingRefresh,
  knownListings,
  previewListingRefresh,
} from "./listing-refresh.ts";
import { catalogTestContext } from "./testing/catalog-fixtures.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

const now = new Date("2026-10-16T23:53:16Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const options = { limit: 500, dryRun: true, retailer: undefined, externalId: undefined };

describe.skipIf(!process.env.TEST_DATABASE_URL)("targeted refresh candidate admission", () => {
  const harness = catalogTestContext({
    ...process.env,
    TEST_DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, query, catalogRows, matchingRows } = harness;

  beforeAll(() => harness.setup(), 30_000);
  beforeEach(() => harness.reset());
  afterAll(async () => {
    try {
      await harness.dispose();
      z.array(z.object({ present: z.literal(false) }))
        .length(1)
        .parse(
          await harness.client.query(
            "select exists(select 1 from pg_namespace where nspname=$1) as present",
            [harness.schema],
          ),
        );
    } finally {
      await closeLocalTestConnections();
    }
  });

  async function seed(
    retailer: RetailerId,
    externalId: string,
    title: string,
    overrides: Partial<NormalizedRetailerListing> = {},
  ) {
    const value: NormalizedRetailerListing = {
      retailer,
      externalId,
      productId: externalId,
      title,
      url: `https://www.${retailer === "plaza-vea" ? "plazavea" : retailer}.com.pe/product/p`,
      currentPriceCents: 500,
      currency: "PEN",
      priceUnit: "UN",
      observedAt: ago(48),
      ...overrides,
    };
    await persistListings(db, retailer, [value]);
    const records = await catalogRows(externalId);
    await persistCatalogNormalizations(db, records);
    const record = records.find((row) => row.retailerId === retailer);
    if (!record) throw new Error("Missing seeded listing");

    return record.id;
  }

  it("unrefreshable exact candidates cannot fill the pool and indefinitely hide useful products", async () => {
    await seed("metro", "legacy-metro", "Arroz Auditrefresh Bolsa 1kg", {
      sourceBrand: "Auditrefresh",
      observedAt: ago(96),
    });
    await seed("plaza-vea", "legacy-plaza", "Arroz Auditrefresh Bolsa 1kg", {
      sourceBrand: "Auditrefresh",
      observedAt: ago(96),
    });
    const snapshots = await matchingRows(["legacy-metro", "legacy-plaza"]);
    await persistMatching(db, snapshots, await evaluatePairs(db, [[snapshots[0]!, snapshots[1]!]]));
    const links = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await query("select distinct canonical_product_id as id from canonical_product_listings"),
      );
    expect(links).toHaveLength(1);

    // Volume copies preserve the writer-established fingerprint/price and paired
    // exact links. They model legacy nonnumeric lookup IDs, not new matching
    // decisions or measured production composition. All writes stay owned.
    await query(`create function refresh_fixture_uuid(value text) returns uuid language sql immutable as $$
      select overlay(overlay(md5(value) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid
    $$`);
    await query(
      `insert into canonical_products
       select (jsonb_populate_record(null::canonical_products,to_jsonb(p)||
         jsonb_build_object('id',refresh_fixture_uuid('refresh-group-'||n),'identity_key',null))).*
       from canonical_products p cross join generate_series(1,2500) n where p.id=$1::uuid`,
      [links[0]!.id],
    );
    await query(
      `insert into retailer_listings
       select (jsonb_populate_record(null::retailer_listings,to_jsonb(l)||jsonb_build_object(
         'id',refresh_fixture_uuid('refresh-listing-'||l.retailer_id||'-'||n),
         'external_id',l.external_id||'-'||n,'product_id',l.product_id||'-'||n))).*
       from retailer_listings l cross join generate_series(1,2500) n`,
    );
    await query(
      `insert into listing_normalizations
       select (jsonb_populate_record(null::listing_normalizations,to_jsonb(v)||jsonb_build_object(
         'listing_id',refresh_fixture_uuid('refresh-listing-'||l.retailer_id||'-'||n)))).*
       from listing_normalizations v join retailer_listings l on l.id=v.listing_id
       cross join generate_series(1,2500) n where l.external_id in ('legacy-metro','legacy-plaza')`,
    );
    await query(
      `insert into price_history
       select (jsonb_populate_record(null::price_history,to_jsonb(h)||jsonb_build_object(
         'id',refresh_fixture_uuid('refresh-history-'||l.retailer_id||'-'||n),
         'listing_id',refresh_fixture_uuid('refresh-listing-'||l.retailer_id||'-'||n)))).*
       from price_history h join retailer_listings l on l.id=h.listing_id
       cross join generate_series(1,2500) n where l.external_id in ('legacy-metro','legacy-plaza')`,
    );
    await query(
      `insert into canonical_product_listings
       select refresh_fixture_uuid('refresh-listing-'||a.retailer_id||'-'||n),
         refresh_fixture_uuid('refresh-group-'||n),a.retailer_id,a.confidence,a.matching_version,a.method,a.reasons,a.linked_at
       from canonical_product_listings a cross join generate_series(1,2500) n
       where a.canonical_product_id=$1::uuid`,
      [links[0]!.id],
    );

    expect(await query("select count(*)::int as total from canonical_product_listings")).toEqual([
      { total: 5002 },
    ]);
    const usefulIds = [
      await seed("metro", "101", "Arroz Habitual Bolsa 1kg"),
      await seed("plaza-vea", "102", "Avena Tradicional Bolsa 1kg"),
      await seed("makro", "103", "Fideos Habituales Bolsa 250g"),
      await seed("tottus", "104", "Arroz Habitual Bolsa 1kg", {
        url: "https://www.tottus.com.pe/tottus-pe/articulo/104/arroz",
      }),
    ];
    const listingState = () =>
      query(`select md5(string_agg(row(id,last_seen_at,last_targeted_attempt_at,
        current_price_cents,available)::text,'' order by id)) as digest from retailer_listings`);
    const before = await listingState();
    const selected = await previewListingRefresh(db, options, now);
    expect(selected.map((row) => row.id).sort()).toEqual([...usefulIds].sort());
    expect(
      selected.every(
        (row) => (row.shoppingRelevant || row.usefulStaple) && hasTargetedRefreshPath(row),
      ),
    ).toBe(true);
    expect(await listingState()).toEqual(before);

    // A failed source keeps its quote and enters the unchanged four-hour
    // cooldown. Another retailer can still make progress on the next selection.
    const first = (await previewListingRefresh(db, { ...options, limit: 1 }, now))[0]!;
    expect(await claimListingRefresh(db, first, now)).toBe(true);
    await finishListingRefresh(db, first, now, "failed");
    const next = await previewListingRefresh(db, options, new Date(now.getTime() + 3_600_000));
    expect(next).toHaveLength(3);
    expect(next.some((row) => row.id === first.id)).toBe(false);
    expect(next.every(hasTargetedRefreshPath)).toBe(true);
    expect(await previewListingRefresh(db, { ...options, retailer: first.retailer }, now)).toEqual(
      [],
    );
    expect(
      await previewListingRefresh(db, options, new Date(now.getTime() + 4 * 3_600_000)),
    ).toHaveLength(4);
    const unchanged = z
      .array(
        z.object({
          current_price_cents: z.number(),
          last_seen_at: z.coerce.date(),
          available: z.boolean().nullable(),
        }),
      )
      .parse(
        await query(
          "select current_price_cents,last_seen_at,available from retailer_listings where id=$1",
          [first.id],
        ),
      );
    expect(unchanged).toEqual([
      { current_price_cents: 500, last_seen_at: ago(48), available: null },
    ]);
  }, 60_000);

  it("uses the same lookup boundary as core while preserving explicit diagnostics, age and negative-stock recovery", async () => {
    const valid = await seed("tottus", "201", "Arroz Habitual Bolsa 1kg", {
      url: "https://www.tottus.com.pe/tottus-pe/articulo/201/arroz",
    });
    const invalid = await seed("tottus", "202", "Arroz Habitual Bolsa 1kg", {
      url: "https://www.tottus.com.pe/tottus-pe/articulo/999/arroz",
    });
    await seed("metro", "203", "Arroz Habitual Bolsa 1kg", { productId: "sku-203" });
    await seed("makro", "204", "Arroz Habitual Bolsa 1kg", { observedAt: ago(5) });
    const negative = await seed("plaza-vea", "205", "Arroz Habitual Bolsa 1kg", {
      observedAt: ago(1),
      available: false,
    });
    await query(
      "update retailer_listings set availability_verified_at=$1::timestamptz where id=$2::uuid",
      [ago(25).toISOString(), negative],
    );
    const all = await knownListings(db);
    expect(
      all
        .filter(hasTargetedRefreshPath)
        .map((row) => row.id)
        .sort(),
    ).toEqual([valid, negative, all.find((row) => row.externalId === "204")!.id].sort());
    expect((await previewListingRefresh(db, options, now)).map((row) => row.id).sort()).toEqual(
      [valid, negative].sort(),
    );
    expect(
      (
        await previewListingRefresh(db, { ...options, retailer: "tottus", externalId: "202" }, now)
      ).map((row) => row.id),
    ).toEqual([invalid]);
  });
});
