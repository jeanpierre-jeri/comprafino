import { seedBasketFixtures } from "./basket-fixtures.ts";
import { seedShoppingListFixtures } from "./shopping-list-e2e-fixtures.ts";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createTestQueryClient, closeLocalTestConnections } from "./test-query-client.ts";
import { z } from "zod";
import { matchingVersion } from "@comprafino/core";
import { testSchemaClient } from "./test-schema-client.ts";
import { requireDatabaseUrl } from "./env.ts";
import { createDatabase } from "./client.ts";
import { getCanonicalProductPriceHistory } from "./price-history.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";
import type { NormalizedRetailerListing } from "@comprafino/core";

// Explicit opt-in only. All test writes and the web server are scoped to this schema.
const url = requireDatabaseUrl({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const client = createTestQueryClient(url, process.env.COMPRAFINO_TEST_DATABASE_MODE);
const schema = `comprafino_e2e_${randomUUID().replaceAll("-", "")}`;
const quoted = `"${schema}"`;
const scopedClient = testSchemaClient(client, schema);
const journal = z
  .object({ entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z_]+$/u) })) })
  .parse(
    JSON.parse(
      readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
    ) as unknown,
  );
let created = false;
try {
  await client.query(`create schema ${quoted}`);
  created = true;
  const path = z
    .array(z.object({ current_schema: z.string() }))
    .parse(await scopedClient.query("select current_schema()"));
  if (path[0]?.current_schema !== schema) throw new Error("E2E schema isolation failed");
  const statements = journal.entries.flatMap(({ tag }) =>
    readFileSync(new URL(`../migrations/${tag}.sql`, import.meta.url), "utf8")
      .split("--> statement-breakpoint")
      .filter((s) => !s.trim().startsWith("CREATE EXTENSION"))
      .map((s) => scopedClient.query(s.replaceAll('"public".', `${quoted}.`))),
  );
  await scopedClient.transaction(statements);
  const db = createDatabase({
    DATABASE_URL: url,
    COMPRAFINO_E2E_SCHEMA: schema,
    COMPRAFINO_TEST_DATABASE_MODE: process.env.COMPRAFINO_TEST_DATABASE_MODE,
  });
  const now = Date.now();
  const fixtures: Record<string, string> = {};
  for (const kind of ["rich", "sparse", "old", "continuous", "gap", "decrease"] as const) {
    const productId = randomUUID();
    fixtures[kind] = productId;
    await scopedClient.query(
      "insert into canonical_products(id,display_name,brand_key,quantity_value,quantity_unit,package_count,total_quantity_value) values($1,$2,'gloria',946,'ml',1,946)",
      [productId, `Leche Gloria Entera 946ml · fixture ${kind}`],
    );
    for (const retailer of ["metro", "plaza-vea", "tottus"] as const) {
      const ages =
        kind === "continuous" || kind === "decrease"
          ? [5, 4, 3, 2, 1, 0]
          : kind === "gap"
            ? [5, 4, 1, 0]
            : kind === "rich" && retailer === "metro"
              ? [80, 40, 8, 0.01]
              : [kind === "old" ? 100 : 0.02];
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
          url:
            retailer === "tottus"
              ? "https://www.tottus.com.pe/tottus-pe/articulo/1/test"
              : retailer === "metro"
                ? "https://www.metro.pe/test/p"
                : "https://www.plazavea.com.pe/test/p",
          currentPriceCents:
            kind === "decrease"
              ? index < 4
                ? 750
                : 600
              : kind === "continuous" || kind === "gap"
                ? 650
                : prices[index]!,
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
      if (!last) throw new Error("Missing fixture observation");
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
  for (const [kind, id] of Object.entries(fixtures)) {
    const history = await getCanonicalProductPriceHistory(db, id);
    if (history?.retailers.length !== 3) throw new Error("Fixture history eligibility failed");
    const metro = history.retailers.find((r) => r.retailerId === "metro");
    if (
      kind === "rich" &&
      (metro?.summary.minimumPriceCents !== 590 ||
        metro.summary.maximumPriceCents !== 610 ||
        metro.summary.changeCount !== 1)
    )
      throw new Error("Rich fixture history mismatch");
    if (
      kind === "continuous" &&
      (metro?.summary.segments.length !== 1 || metro.summary.verifiedUnchangedDays !== 6)
    )
      throw new Error("Continuous fixture mismatch");
    if (
      kind === "gap" &&
      (metro?.summary.segments.length !== 2 || metro.summary.verifiedUnchangedDays !== 2)
    )
      throw new Error("Gap fixture mismatch");
    if (kind === "decrease" && metro?.summary.lastChange?.differenceCents !== -150)
      throw new Error("Decrease fixture mismatch");
    if (kind === "sparse" && metro?.summary.status !== "insufficient")
      throw new Error("Sparse fixture mismatch");
    if (kind === "old" && metro?.summary.status !== "empty")
      throw new Error("Old fixture mismatch");
  }
  const shopping = process.argv.includes("--shopping-list");
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
        ["test:e2e", shopping ? "shopping-list.spec.ts" : "price-history.spec.ts"],
        {
          cwd: new URL("../../../", import.meta.url),
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: url,
            COMPRAFINO_E2E_SCHEMA: schema,
            PRICE_HISTORY_FIXTURE_IDS: JSON.stringify(fixtures),
            SHOPPING_LIST_FIXTURE_IDS: JSON.stringify(shoppingFixtures),
          },
        },
      );
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode) process.exitCode = exitCode;
  }
} finally {
  try {
    if (created) await client.query(`drop schema ${quoted} cascade`);
  } finally {
    await closeLocalTestConnections();
  }
}
