import { createDatabase } from "./client.ts";
import { matchCatalog } from "./matching.ts";
import { parseCatalogOptions } from "./catalog-options.ts";
try {
  const options = parseCatalogOptions(process.argv.slice(2));
  if (options.retailer) throw new Error("Matching requires a cross-retailer scope");
  const r = await matchCatalog(createDatabase(), options.limit, options.dryRun);
  console.log(
    JSON.stringify(
      {
        version: r.version,
        dryRun: options.dryRun,
        metrics: r.metrics,
        persisted: r.persisted,
        samples: r.pairs
          .filter((p) => p.result.decision === "auto_match")
          .slice(0, 5)
          .map((p) => ({
            ...p,
            a: r.rows.find((row) => row.id === p.a)?.title,
            b: r.rows.find((row) => row.id === p.b)?.title,
          })),
      },
      null,
      2,
    ),
  );
  if (r.persisted?.stale) {
    console.error(
      "Matching scope changed, contains manual links, or cuts an existing group. Retry with a complete normalized scope.",
    );
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Catalog matching failed. Check options, DATABASE_URL, migrations and fresh normalization.",
  );
  process.exitCode = 1;
}
