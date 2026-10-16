import { logDiagnostic } from "./diagnostics.ts";
import { shoppingListSchema, shoppingListEvaluationSchema, priceMode } from "@comprafino/core";
import { createDatabase, evaluateCurrentShoppingList } from "@comprafino/db";

import { boundedJson } from "./request-body.ts";
import { publicRequestPolicy } from "../lib/public-request-policy.ts";
import { withinRequestBudget } from "../lib/request-budget.ts";
import { publicDatabaseOptions } from "./public-database.ts";

// Explicit test/benchmark factory; the production route supplies its normal client.
export function shoppingListPost(
  database: typeof createDatabase = createDatabase,
  evaluate: typeof evaluateCurrentShoppingList = evaluateCurrentShoppingList,
  budgetMs: number = publicRequestPolicy.operationMs,
) {
  return async function POST(request: Request) {
    const started = performance.now();
    try {
      return await withinRequestBudget(budgetMs, request.signal, async (signal) => {
        const input = await boundedJson(request, signal);

        if ("status" in input) {
          return Response.json(
            { error: "Lista inválida" },
            { status: input.status, headers: { "Cache-Control": "no-store" } },
          );
        }

        const body = input.body;
        const parsed = shoppingListSchema.safeParse(body);

        if (!parsed.success) return Response.json({ error: "Lista inválida" }, { status: 400 });

        const mode = priceMode(new URL(request.url).searchParams.get("priceMode"));

        signal.throwIfAborted();
        const result = await evaluate(
          database(process.env, publicDatabaseOptions(signal)),
          parsed.data,
          mode,
        );
        result.timings.totalMs = performance.now() - started;
        const response = shoppingListEvaluationSchema.parse(result);

        return Response.json(response, {
          headers: {
            "Cache-Control": "no-store",
            "Server-Timing": `db;dur=${result.timings.queryMs.toFixed(2)}, evaluate;dur=${result.timings.totalMs.toFixed(2)}`,
          },
        });
      });
    } catch (error) {
      logDiagnostic(error, { stage: "public", operation: "evaluation", reason: "db_read_failed" });

      return Response.json(
        { error: "No pudimos cargar los precios. Intenta nuevamente." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
