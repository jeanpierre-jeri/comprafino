import { z } from "zod";
import type { ownedTestDatabase } from "./database.ts";
import { persistListings } from "../ingestion.ts";
import { persistCatalogNormalizations } from "../catalog.ts";

export async function seedBenchmarkFiller({ db, scoped }: ReturnType<typeof ownedTestDatabase>) {
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
}

export async function benchmarkCatalogCount({ scoped }: ReturnType<typeof ownedTestDatabase>) {
  const rows = z
    .array(z.object({ count: z.coerce.number() }))
    .parse(await scoped.query("select count(*) from retailer_listings"));

  return rows[0]!.count;
}
