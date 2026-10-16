import { randomUUID } from "node:crypto";
import { searchFilters, shoppingListSchema } from "@comprafino/core";
import type { ownedTestDatabase } from "./database.ts";
import type { catalogBenchmarkObserver } from "./catalog-benchmark-observer.ts";
import { searchPublicProducts } from "../generic-offers.ts";
import { evaluateCurrentShoppingList } from "../shopping-list.ts";

/** Optional paired SQL diagnostics, after timed workloads, in the same owned fixture. */
export async function catalogBenchmarkDiagnostics(
  harness: ReturnType<typeof ownedTestDatabase>,
  observer: ReturnType<typeof catalogBenchmarkObserver>,
  exactIds: readonly string[],
  now: Date,
) {
  const strictList = shoppingListSchema.parse({
    version: 2,
    items: exactIds.map((id, index) => ({
      id: randomUUID(),
      label: "Producto exacto",
      query: "arroz",
      intent: "strict",
      canonicalId: id,
      quantityMode: "packages",
      quantity: { amount: (index % 3) + 1, unit: "unit" },
      frequency: "weekly",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })),
  });
  const cases = [
    {
      id: "family",
      setting: "enable_nestloop",
      run: () =>
        searchPublicProducts(observer.db, "arroz", "relevance", now, searchFilters(), 1, {
          includeComparisons: false,
        }),
    },
    {
      id: "category-text",
      setting: "enable_nestloop",
      run: () =>
        searchPublicProducts(
          observer.db,
          "benchcatalogo",
          "relevance",
          now,
          searchFilters({ category: "lacteos-huevos" }),
          1,
          { includeComparisons: false },
        ),
    },
    {
      id: "strict-50",
      setting: "jit",
      run: () => evaluateCurrentShoppingList(observer.db, strictList, "standard", now),
    },
  ];
  const diagnostics = [];
  for (const scenario of cases) {
    const probe = await observer.observe<unknown>(scenario.run, true);
    const original = await observer.explain(probe.metrics.statements);
    const alternate = [];
    for (const statement of probe.metrics.statements) {
      // The setting expires at COMMIT; application SQL and global settings are untouched.
      const results = await harness.scoped.transaction([
        harness.scoped.query("select set_config($1,'off',true)", [scenario.setting]),
        harness.scoped.query(
          `explain (analyze,buffers,format json) ${statement.query}`,
          statement.params,
        ),
      ]);
      alternate.push(results[1]);
    }
    diagnostics.push({
      id: scenario.id,
      setting: scenario.setting,
      original,
      transactionSettingOff: alternate,
    });
    console.log(`SQL diagnostic completed: ${scenario.id}`);
  }
  return {
    measuredAt: new Date().toISOString(),
    asOf: now.toISOString(),
    schema: harness.schema,
    diagnostics,
    note: "One diagnostic plan per condition after baseline workloads. Not p50/p95 or a production configuration recommendation. Settings are transaction-local only.",
  };
}
