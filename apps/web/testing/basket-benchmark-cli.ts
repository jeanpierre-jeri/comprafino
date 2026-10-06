import {
  seedBenchmarkFiller,
  benchmarkCatalogCount,
} from "../../../packages/db/src/testing/basket-benchmark-fixtures.ts";
import { ownedTestDatabase } from "../../../packages/db/src/testing/database.ts";
import { reportOutputPath, writeReport } from "../../../packages/db/src/report-output.ts";
import { randomUUID } from "node:crypto";

import {
  shoppingListItemSchema,
  shoppingListSchema,
  shoppingListEvaluationSchema,
  inferGenericSubstitutionProfile,
} from "@comprafino/core";
import type { PriceMode, ShoppingListItem } from "@comprafino/core";
import { shoppingListPost } from "../src/server/shopping-list-handler.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";

import { seedShoppingListFixtures } from "../../../packages/db/src/shopping-list-e2e-fixtures.ts";
import { seedBasketFixtures } from "../../../packages/db/src/basket-fixtures.ts";

// Explicit test DB only; never reads .env or falls back to the application DB.
const outputPath = reportOutputPath(process.argv.slice(2));

const harness = ownedTestDatabase();

const { scoped, db } = harness;

const POST = shoppingListPost(() => db);

try {
  await harness.setup();
  await seedShoppingListFixtures(db, scoped);
  const fixtures = await seedBasketFixtures(db, scoped, 22);
  await seedBenchmarkFiller(harness);
  const now = new Date();
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
  ] as const) {
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
  }

  for (const [index, canonicalId] of Object.values(fixtures).entries()) {
    for (const intent of ["strict", "preferred"] as const) {
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
    }
  }

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

        if (!response.ok) {
          throw new Error(`Benchmark API failed: ${response.status}`);
        }

        const body = shoppingListEvaluationSchema.parse(await response.json());
        const wallMs = performance.now() - start;

        if (run > 0) {
          samples.push({ ...body.timings, handlerResponseMs: wallMs });
        }
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

  const report = {
    measuredAt: new Date().toISOString(),
    environment:
      "Isolated loopback PostgreSQL 17; native TypeScript execution of the actual POST handler, no Next.js HTTP server or deployment/network overhead",
    catalogListings: await benchmarkCatalogCount(harness),
    warmupsPerCase: 1,
    measuredRunsPerCase: 5,
    measurements,
  };
  writeReport(outputPath, report);
  console.log(
    JSON.stringify(
      {
        outputPath,
        catalogListings: report.catalogListings,
        measurements: measurements.map(({ samples: _samples, ...m }) => m),
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await harness.dispose();
  } finally {
    await closeLocalTestConnections();
  }
}
