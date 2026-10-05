import { shoppingListSchema, priceMode } from "@comprafino/core";
import { createDatabase, evaluateCurrentShoppingItem } from "@comprafino/db";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = shoppingListSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Lista inválida" }, { status: 400 });
  const mode = priceMode(new URL(request.url).searchParams.get("priceMode"));
  try {
    const db = createDatabase();
    const now = new Date();
    const evaluations = [];
    // Bound work and avoid a burst of up to 100 parallel catalog queries.
    for (const item of parsed.data.items)
      evaluations.push(await evaluateCurrentShoppingItem(db, item, mode, now));
    return Response.json({ evaluations }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Shopping list current-offer query failed.");
    return Response.json(
      { error: "No pudimos cargar los precios. Intenta nuevamente." },
      { status: 503 },
    );
  }
}
