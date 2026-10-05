import { createDatabase, searchCanonicalProducts, usefulSearchQuery } from "@comprafino/db";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (!usefulSearchQuery(query)) return Response.json({ products: [] });
  try {
    const products = await searchCanonicalProducts(createDatabase(), query);
    return Response.json(
      { products: products.map((p) => ({ id: p.id, label: p.displayName })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "No pudimos buscar productos." }, { status: 503 });
  }
}
