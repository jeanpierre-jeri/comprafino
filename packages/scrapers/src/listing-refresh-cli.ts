import { parseListingRefreshOptions } from "@comprafino/core";
import {
  createDatabase,
  previewListingRefresh,
  normalizeCatalog,
  matchCatalog,
  assertRefreshScope,
} from "@comprafino/db";
import { refreshKnownListings } from "./listing-refresh.ts";
import { listingRefreshTasks } from "./listing-refresh-tasks.ts";
try {
  const options = parseListingRefreshOptions(process.argv.slice(2));
  const db = createDatabase();
  const rows = await previewListingRefresh(db, options);
  if (options.dryRun)
    console.log(JSON.stringify({ dryRun: true, selected: rows, requests: 0, writes: 0 }, null, 2));
  else {
    const result = await refreshKnownListings(rows, listingRefreshTasks(db));
    let normalizationWrites = 0;
    let matchingWrites = 0;
    let normalization: "skipped" | "success" | "failed" = "skipped";
    let matching: "skipped" | "success" | "failed" = "skipped";
    if (result.observed > 0) {
      try {
        await assertRefreshScope(db);
        const normalized = await normalizeCatalog(db, 1000);
        if (!normalized.persisted || normalized.persisted.stale)
          throw new Error("Stale normalization");
        normalizationWrites = normalized.persisted.changed;
        normalization = "success";
      } catch {
        normalization = "failed";
      }
      if (normalization === "success") {
        try {
          const matched = await matchCatalog(db, 1000);
          if (!matched.persisted || matched.persisted.stale) throw new Error("Stale matching");
          matchingWrites =
            matched.persisted.linksCreated +
            matched.persisted.linksRemoved +
            matched.persisted.productsCreated +
            matched.persisted.productsUpdated +
            matched.persisted.productsRemoved;
          matching = "success";
        } catch {
          matching = "failed";
        }
      }
    }
    console.log(
      JSON.stringify(
        { ...result, normalization, matching, normalizationWrites, matchingWrites },
        null,
        2,
      ),
    );
    if (result.failures || normalization === "failed" || matching === "failed")
      process.exitCode = 1;
  }
} catch {
  console.error(
    "Known listing refresh failed. Check options, database migrations and complete scope; no credentials logged.",
  );
  process.exitCode = 1;
}
