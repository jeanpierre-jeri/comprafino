import { createDatabase } from "./client.ts";
import { normalizeCatalog } from "./catalog.ts";
import { parseCatalogOptions } from "./catalog-options.ts";

try {
  const options = parseCatalogOptions(process.argv.slice(2));
  const result = await normalizeCatalog(
    createDatabase(),
    options.limit,
    options.retailer,
    options.dryRun,
  );
  console.log(
    JSON.stringify(
      {
        retailer: options.retailer ?? "all",
        dryRun: options.dryRun,
        coverage: result.coverage,
        persisted: result.persisted,
        samples: result.samples.slice(0, 5),
      },
      null,
      2,
    ),
  );
} catch {
  // Driver errors can include connection/query details; do not print credentials.
  console.error(
    "Catalog normalization failed. Check options, DATABASE_URL and applied migrations.",
  );
  process.exitCode = 1;
}
