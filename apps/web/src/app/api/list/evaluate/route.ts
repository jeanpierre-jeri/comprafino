import { shoppingListSchema, shoppingListEvaluationSchema, priceMode } from "@comprafino/core";
import { createDatabase, evaluateCurrentShoppingList } from "@comprafino/db";

export async function POST(request: Request) {
  const started = performance.now();
  const body: unknown = await request.json().catch(() => null);
  const parsed = shoppingListSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Lista inválida" }, { status: 400 });
  const mode = priceMode(new URL(request.url).searchParams.get("priceMode"));
  try {
    const result = await evaluateCurrentShoppingList(createDatabase(), parsed.data, mode);
    result.timings.totalMs = performance.now() - started;
    const response = shoppingListEvaluationSchema.parse(result);
    return Response.json(response, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `db;dur=${result.timings.queryMs.toFixed(2)}, evaluate;dur=${result.timings.totalMs.toFixed(2)}`,
      },
    });
  } catch {
    console.error("Shopping list current-offer query failed.");
    return Response.json(
      { error: "No pudimos cargar los precios. Intenta nuevamente." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
