import { logDiagnostic } from "./diagnostics.ts";
import { shoppingListSchema, shoppingListEvaluationSchema, priceMode } from "@comprafino/core";
import { createDatabase, evaluateCurrentShoppingList } from "@comprafino/db";

import { boundedJson } from "./request-body.ts";

// Explicit test/benchmark factory; the production route supplies its normal client.
export function shoppingListPost(
  database: typeof createDatabase = createDatabase,
  evaluate: typeof evaluateCurrentShoppingList = evaluateCurrentShoppingList,
) {
  return async function POST(request: Request) {
    const started = performance.now();
    const input = await boundedJson(request);

    if ("status" in input) {
      return Response.json({ error: "Lista inválida" }, { status: input.status });
    }

    const body = input.body;
    const parsed = shoppingListSchema.safeParse(body);

    if (!parsed.success) return Response.json({ error: "Lista inválida" }, { status: 400 });

    const mode = priceMode(new URL(request.url).searchParams.get("priceMode"));

    try {
      const result = await evaluate(database(), parsed.data, mode);
      result.timings.totalMs = performance.now() - started;
      const response = shoppingListEvaluationSchema.parse(result);

      return Response.json(response, {
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `db;dur=${result.timings.queryMs.toFixed(2)}, evaluate;dur=${result.timings.totalMs.toFixed(2)}`,
        },
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
