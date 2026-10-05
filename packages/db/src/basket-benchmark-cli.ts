import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  shoppingListItemSchema,
  shoppingListSchema,
  shoppingListEvaluationSchema,
  inferGenericSubstitutionProfile,
} from "@comprafino/core";
import type { PriceMode, ShoppingListItem } from "@comprafino/core";
import { POST } from "../../../apps/web/src/app/api/list/evaluate/route.ts";
import { createDatabase } from "./client.ts";
import { createTestQueryClient, closeLocalTestConnections } from "./test-query-client.ts";
import { testSchemaClient } from "./test-schema-client.ts";
import { requireDatabaseUrl } from "./env.ts";
import { seedShoppingListFixtures } from "./shopping-list-e2e-fixtures.ts";
import { seedBasketFixtures } from "./basket-fixtures.ts";
import { persistListings } from "./ingestion.ts";
import { persistCatalogNormalizations } from "./catalog.ts";

// Explicit test DB only; never reads .env or falls back to the application DB.
const url = requireDatabaseUrl({ DATABASE_URL: process.env.TEST_DATABASE_URL });
const client = createTestQueryClient(url, process.env.COMPRAFINO_TEST_DATABASE_MODE);
const schema = `comprafino_e2e_${randomUUID().replaceAll("-", "")}`;
const scoped = testSchemaClient(client, schema);
let created = false;
const originalUrl = process.env.DATABASE_URL;
const originalSchema = process.env.COMPRAFINO_E2E_SCHEMA;
try {
  await client.query(`create schema "${schema}"`);
  created = true;
  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z_]+$/u) })) })
    .parse(
      JSON.parse(
        readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
      ) as unknown,
    );
  await scoped.transaction(
    journal.entries.flatMap(({ tag }) =>
      readFileSync(new URL(`../migrations/${tag}.sql`, import.meta.url), "utf8")
        .split("--> statement-breakpoint")
        .filter((s) => !s.trim().startsWith("CREATE EXTENSION"))
        .map((s) => scoped.query(s.replaceAll('"public".', `"${schema}".`))),
    ),
  );
  process.env.DATABASE_URL = url;
  process.env.COMPRAFINO_E2E_SCHEMA = schema;
  const db = createDatabase();
  await seedShoppingListFixtures(db, scoped);
  const fixtures = await seedBasketFixtures(db, scoped, 22);
  const now = new Date();
  const filler = Array.from({ length: 826 }, (_, i) => ({
    retailer: "metro" as const,
    externalId: `benchmark-${i}`,
    productId: `benchmark-${i}`,
    title: i % 2 ? "Arroz Blanco Bolsa 1kg" : "Detergente en Polvo Bolsa 1kg",
    url: "https://www.metro.pe/benchmark/p",
    currentPriceCents: 1000 + i,
    currency: "PEN" as const,
    priceUnit: "UN" as const,
    observedAt: now,
  }));
  await persistListings(db, "metro", filler);
  const rows = z
    .array(z.object({ id: z.uuid(), external_id: z.string() }))
    .parse(
      await scoped.query(
        "select id,external_id from retailer_listings where external_id like 'benchmark-%'",
      ),
    );
  const ids = new Map(rows.map((r) => [r.external_id, r.id]));
  await persistCatalogNormalizations(
    db,
    filler.map((l) => ({ ...l, id: ids.get(l.externalId)!, retailerId: "metro" })),
  );
  const items: ShoppingListItem[] = [];
  const common = {
    frequency: "weekly",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  for (const [query, unit, amount] of [
    ["huevos", "unit", 30],
    ["arroz", "kg", 5],
    ["aceite", "L", 3],
    ["detergente", "kg", 3],
    ["leche", "unit", 6],
    ["huevos de codorniz", "unit", 30],
  ] as const)
    items.push(
      shoppingListItemSchema.parse({
        ...common,
        id: randomUUID(),
        label: query,
        query,
        canonicalId: null,
        intent: "generic",
        substitutionProfile: inferGenericSubstitutionProfile(query, unit),
        quantityMode: "normalized",
        quantity: { amount, unit },
      }),
    );
  for (const [index, canonicalId] of Object.values(fixtures).entries())
    for (const intent of ["strict", "preferred"] as const)
      items.push(
        shoppingListItemSchema.parse({
          ...common,
          id: randomUUID(),
          label: `Leche ${index}`,
          query: "leche",
          canonicalId,
          intent,
          quantityMode: "packages",
          quantity: { amount: (index % 3) + 1, unit: "unit" },
        }),
      );
  // The 5-item sample has supported staples and exact/preferred milk; larger
  // samples also include deliberately unsupported generic needs.
  const ordered = [
    ...items.slice(0, 3),
    ...items.slice(6, 8),
    ...items.slice(3, 6),
    ...items.slice(8),
  ];
  const measurements = [];
  for (const count of [5, 20, 50]) {
    const list = shoppingListSchema.parse({ version: 2, items: ordered.slice(0, count) });
    for (const mode of ["standard", "benefits"] satisfies PriceMode[]) {
      const samples: { queryMs: number; totalMs: number; handlerResponseMs: number }[] = [];
      for (let run = 0; run < 6; run++) {
        const request = new Request(`http://localhost/api/list/evaluate?priceMode=${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(list),
        });
        const start = performance.now();
        const response = await POST(request);
        if (!response.ok) throw new Error(`Benchmark API failed: ${response.status}`);
        const body = shoppingListEvaluationSchema.parse(await response.json());
        const wallMs = performance.now() - start;
        if (run > 0) samples.push({ ...body.timings, handlerResponseMs: wallMs });
      }
      const stats = (key: keyof (typeof samples)[number]) => {
        const values = samples.map((s) => s[key]).sort((a, b) => a - b);
        return { min: values[0], median: values[2], max: values[4] };
      };
      measurements.push({
        items: count,
        mode,
        queryMs: stats("queryMs"),
        totalMs: stats("totalMs"),
        handlerResponseMs: stats("handlerResponseMs"),
        samples,
      });
    }
  }
  const countRows = z
    .array(z.object({ count: z.coerce.number() }))
    .parse(await scoped.query("select count(*) from retailer_listings"));
  const report = {
    measuredAt: new Date().toISOString(),
    environment:
      "Isolated loopback PostgreSQL 17; native TypeScript execution of the actual POST handler, no Next.js HTTP server or deployment/network overhead",
    catalogListings: countRows[0]!.count,
    warmupsPerCase: 1,
    measuredRunsPerCase: 5,
    measurements,
  };
  writeFileSync(
    new URL("../../../docs/milestone-16-performance.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        catalogListings: report.catalogListings,
        measurements: measurements.map(({ samples: _samples, ...m }) => m),
      },
      null,
      2,
    ),
  );
} finally {
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
  if (originalSchema === undefined) delete process.env.COMPRAFINO_E2E_SCHEMA;
  else process.env.COMPRAFINO_E2E_SCHEMA = originalSchema;
  try {
    if (created) await client.query(`drop schema "${schema}" cascade`);
  } finally {
    await closeLocalTestConnections();
  }
}
