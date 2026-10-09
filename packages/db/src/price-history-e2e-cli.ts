import { fixtureDatabaseUrl } from "./testing/fixture-url.ts";
import { ownedTestDatabase } from "./testing/database.ts";
import { getPublicRetailerListingDetail } from "./listing-detail.ts";
import { seedBasketFixtures } from "./basket-fixtures.ts";
import { seedShoppingListFixtures } from "./shopping-list-e2e-fixtures.ts";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { z } from "zod";
import { matchingVersion } from "@comprafino/core";

import { getCanonicalProductPriceHistory } from "./price-history.ts";
import { knownListings, claimListingRefresh, finishListingRefresh } from "./listing-refresh.ts";
import { searchGenericProductOffers } from "./generic-offers.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";

// Explicit opt-in only. All test writes and the web server are scoped to this schema.
const harness = ownedTestDatabase();

const { url, schema, scoped: scopedClient, db } = harness;

try {
  await harness.setup();
  const all = process.argv.includes("--all");
  const listings = all || process.argv.includes("--listings");
  const now = Date.now();
  const fixtures: Record<string, string> = {};

  for (const kind of ["rich", "sparse", "old", "continuous", "gap", "decrease"] as const) {
    const productId = randomUUID();
    fixtures[kind] = productId;
    await scopedClient.query(
      "insert into canonical_products(id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value) values($1,$2,'gloria',946,'ml',1,946)",
      [productId, `Leche Gloria Entera 946ml · fixture ${kind}`],
    );

    for (const retailer of ["metro", "plaza-vea", "tottus", "makro"] as const) {
      let ages;

      if (kind === "continuous" || kind === "decrease") {
        ages = [5, 4, 3, 2, 1, 0];
      } else if (kind === "gap") {
        ages = [5, 4, 1, 0];
      } else if (kind === "rich" && retailer === "metro") {
        ages = [80, 40, 8, 0.01];
      } else {
        ages = [kind === "old" ? 100 : 0.02];
      }

      const prices =
        kind === "rich" && retailer === "metro"
          ? [700, 620, 590, 610]
          : [retailer === "tottus" ? 640 : 650];
      let last: NormalizedRetailerListing | undefined;

      for (const [index, age] of ages.entries()) {
        const observedAt = new Date(now - age * 86_400_000);
        last = {
          retailer,
          externalId: `${kind}-${retailer}`,
          productId: `${kind}-${retailer}`,
          title: "Leche Gloria Entera Caja 946ml",
          sourceBrand: "Gloria",
          url: {
            tottus: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
            metro: "https://www.metro.pe/test/p",
            makro: "https://www.makro.plazavea.com.pe/test/p",
            "plaza-vea": "https://www.plazavea.com.pe/test/p",
          }[retailer],
          currentPriceCents: observedFixturePrice(kind, index, prices),
          currency: "PEN",
          priceUnit: "UN",
          observedAt,
          ...(retailer === "tottus"
            ? {
                conditionalOffers: [
                  {
                    conditionType: "payment_card" as const,
                    programKey: "cmr" as const,
                    conditionLabel: "Requiere tarjeta CMR" as const,
                    priceCents: 540,
                    observedAt,
                  },
                ],
              }
            : {}),
        };
        await persistListings(db, retailer, [last]);
      }

      const ids = z
        .array(z.object({ id: z.uuid() }))
        .parse(
          await scopedClient.query(
            "select id from retailer_listings where retailer_id=$1 and external_id=$2",
            [retailer, `${kind}-${retailer}`],
          ),
        );
      const id = ids[0]!.id;

      if (listings) {
        fixtures[`listing-${kind}-${retailer}`] = id;
      }

      if (!last) {
        throw new Error("Missing fixture observation");
      }

      const listing = {
        id,
        retailerId: retailer,
        title: last.title,
        sourceBrand: "Gloria",
        packageText: null,
        sourceUnitMultiplier: null,
        priceUnit: "UN" as const,
        observedAt: last.observedAt,
      };
      await persistCatalogNormalizations(db, [listing]);
      await scopedClient.query(
        "insert into canonical_product_listings(listing_id,canonical_product_id,retailer_id,confidence,matching_version,method,reasons) values($1,$2,$3,1,$4,'automatic',ARRAY['controlled fixture'])",
        [id, productId, retailer, matchingVersion],
      );
    }
  }

  if (listings) {
    const value: NormalizedRetailerListing = {
      retailer: "tottus",
      externalId: "independent-listing",
      productId: "independent-listing",
      title: "Huevos Pardos Tottus Bandeja 30un",
      currency: "PEN",
      priceUnit: "UN",
      // Keep unrelated listing fixtures above controlled shopping winners.
      currentPriceCents: 4990,
      regularPriceCents: 5990,
      observedAt: new Date(now - 60000),
      url: "https://www.tottus.com.pe/tottus-pe/articulo/1/test",
    };
    await persistListings(db, "tottus", [value]);
    const ids = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await scopedClient.query(
          "select id from retailer_listings where external_id='independent-listing'",
        ),
      );
    fixtures.independent = ids[0]!.id;
    await persistCatalogNormalizations(db, [
      {
        id: fixtures.independent,
        retailerId: "tottus",
        title: value.title,
        priceUnit: "UN",
        packageText: null,
        sourceBrand: null,
        sourceUnitMultiplier: null,
      },
    ]);
  }

  if (listings) {
    for (const state of ["unavailable", "recovered"] as const) {
      const value: NormalizedRetailerListing = {
        retailer: "metro",
        externalId: `availability-${state}`,
        productId: `availability-${state}`,
        title: `Huevos Availability ${state} Bandeja 30un`,
        url: "https://www.metro.pe/availability/p",
        currentPriceCents: 2790,
        currency: "PEN",
        priceUnit: "UN",
        available: true,
        observedAt: new Date(now - 60000),
      };
      await persistListings(db, "metro", [value]);
      const known = (await knownListings(db)).find((r) => r.externalId === value.externalId)!;
      const at = new Date(now - 30000);

      if (!(await claimListingRefresh(db, known, at))) {
        throw new Error("Availability fixture admission failed");
      }

      await finishListingRefresh(db, known, at, "unavailable");

      if (state === "recovered") {
        await persistListings(db, "metro", [{ ...value, observedAt: new Date(now - 1000) }]);
      }

      await persistCatalogNormalizations(db, [{ ...value, id: known.id, retailerId: "metro" }]);
      fixtures[`listing-${state}`] = known.id;
      const detail = await getPublicRetailerListingDetail(db, known.id);
      const offers = await searchGenericProductOffers(db, "huevos availability", "relevance");

      if (
        !detail?.history ||
        detail.current !== (state === "recovered") ||
        offers.some((o) => o.id === known.id) !== (state === "recovered")
      ) {
        throw new Error("Availability fixture current/history mismatch");
      }

      const history = z
        .object({ count: z.number() })
        .parse(
          (
            await scopedClient.query(
              "select count(*)::int as count from price_history where listing_id=$1",
              [known.id],
            )
          )[0],
        );

      if (history.count !== 1) {
        throw new Error("Availability fixture modified ordinary history");
      }
    }
  }

  for (const [kind, id] of Object.entries(fixtures).filter(
    ([key]) => !key.startsWith("listing-") && key !== "independent",
  )) {
    const history = await getCanonicalProductPriceHistory(db, id);

    if (history?.retailers.length !== 4) {
      throw new Error("Fixture history eligibility failed");
    }

    const metro = history.retailers.find((r) => r.retailerId === "metro");

    if (
      kind === "rich" &&
      (metro?.summary.minimumPriceCents !== 590 ||
        metro.summary.maximumPriceCents !== 610 ||
        metro.summary.changeCount !== 1)
    ) {
      throw new Error("Rich fixture history mismatch");
    }

    if (
      kind === "continuous" &&
      (metro?.summary.segments.length !== 1 || metro.summary.verifiedUnchangedDays !== 6)
    ) {
      throw new Error("Continuous fixture mismatch");
    }

    if (
      kind === "gap" &&
      (metro?.summary.segments.length !== 2 || metro.summary.verifiedUnchangedDays !== 2)
    ) {
      throw new Error("Gap fixture mismatch");
    }

    if (kind === "decrease" && metro?.summary.lastChange?.differenceCents !== -150) {
      throw new Error("Decrease fixture mismatch");
    }

    if (kind === "sparse" && metro?.summary.status !== "insufficient") {
      throw new Error("Sparse fixture mismatch");
    }

    if (kind === "old" && metro?.summary.status !== "empty") {
      throw new Error("Old fixture mismatch");
    }
  }

  if (listings) {
    const unmatched = await getPublicRetailerListingDetail(db, fixtures.independent!);

    if (!unmatched || unmatched.canonicalId || !unmatched.current) {
      throw new Error("Unmatched listing fixture failed");
    }

    for (const [range, maximum] of [
      ["7d", 610],
      ["30d", 620],
      ["90d", 700],
    ] as const) {
      const rich = await getPublicRetailerListingDetail(db, fixtures["listing-rich-metro"]!, {
        range,
      });

      if (
        rich?.canonicalId !== fixtures.rich ||
        rich?.history?.retailers[0]?.summary.maximumPriceCents !== maximum
      ) {
        throw new Error("Listing range fixture failed");
      }
    }

    const cmr = await getPublicRetailerListingDetail(db, fixtures["listing-rich-tottus"]!);

    if (
      cmr?.conditionalOffers[0]?.priceCents !== 540 ||
      cmr.history?.retailers[0]?.summary.minimumPriceCents !== 640
    ) {
      throw new Error("Listing CMR fixture failed");
    }

    for (const [kind, days, segments] of [
      ["continuous", 6, 1],
      ["gap", 2, 2],
    ] as const) {
      const detail = await getPublicRetailerListingDetail(db, fixtures[`listing-${kind}-metro`]!);
      const summary = detail?.history?.retailers[0]?.summary;

      if (summary?.verifiedUnchangedDays !== days || summary.segments.length !== segments) {
        throw new Error("Listing coverage fixture failed");
      }
    }
  }

  const shopping = all || process.argv.includes("--shopping-list");
  const shoppingFixtures = shopping
    ? {
        ...(await seedShoppingListFixtures(db, scopedClient)),
        ...(await seedBasketFixtures(db, scopedClient)),
      }
    : {};

  if (process.argv.includes("--validate-fixtures")) {
    console.log(
      shopping
        ? "Validated history and shopping-list fixtures in an isolated schema; browser tests were not run."
        : "Validated rich, sparse, outside-range, continuous, gap and decrease fixtures in an isolated schema; browser tests were not run.",
    );
  } else {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        "pnpm",
        [
          "test:e2e",
          ...process.argv
            .slice(2)
            .filter(
              (arg) =>
                !["--", "--all", "--listings", "--shopping-list", "--validate-fixtures"].includes(
                  arg,
                ),
            ),
          ...(all ? [] : [browserFixtureSpec(listings, shopping)]),
        ],
        {
          cwd: new URL("../../../", import.meta.url),
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: fixtureDatabaseUrl(url, process.env.COMPRAFINO_TEST_DATABASE_MODE),
            COMPRAFINO_E2E_PRELOAD: new URL("./testing/http-preload.ts", import.meta.url).href,
            COMPRAFINO_CONTROLLED_E2E: all ? "1" : "",
            COMPRAFINO_E2E_SCHEMA: schema,
            PRICE_HISTORY_FIXTURE_IDS: JSON.stringify(fixtures),
            SHOPPING_LIST_FIXTURE_IDS: JSON.stringify(shoppingFixtures),
          },
        },
      );
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });

    if (exitCode) {
      process.exitCode = exitCode;
    }
  }
} finally {
  try {
    await harness.dispose();
  } finally {
    await closeLocalTestConnections();
  }
}

function observedFixturePrice(kind: string, index: number, prices: readonly number[]): number {
  if (kind === "decrease") return index < 4 ? 750 : 600;

  if (kind === "continuous" || kind === "gap") return 650;

  return prices[index]!;
}

function browserFixtureSpec(listings: boolean, shopping: boolean): string {
  if (listings) return "listing-detail.spec.ts";

  return shopping ? "shopping-list.spec.ts" : "price-history.spec.ts";
}
