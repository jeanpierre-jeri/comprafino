import { createDatabase } from "./client.ts";
import { parseCatalogOptions } from "./catalog-options.ts";
import { normalizeChangedCatalog } from "./catalog.ts";
import { matchChangedCatalog } from "./matching.ts";
import { assertRefreshScope } from "./operations.ts";
import { inspectCatalogWork } from "./catalog-acquisition.ts";

try {
  const options = parseCatalogOptions(process.argv.slice(2));
  if (options.retailer) {
    throw new Error("Derivation requires a cross-retailer scope");
  }
  const db = createDatabase();
  await assertRefreshScope(db);
  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, writes: 0, pending: await inspectCatalogWork(db) }));
  } else {
    const normalization = await normalizeChangedCatalog(db, options.limit);
    const matching = await matchChangedCatalog(db, Math.min(1000, options.limit));
    console.log(JSON.stringify({ normalization, matching, pending: await inspectCatalogWork(db) }));
    if (matching.deferred) {
      process.exitCode = 1;
    }
  }
} catch {
  console.error(
    "Incremental derivation failed; pending work retained. Check migrations and snapshots; no credentials logged.",
  );
  process.exitCode = 1;
}
