import { logDiagnostic } from "./diagnostics.ts";
import { listingRefreshPolicy } from "@comprafino/core";
import { refreshKnownListings } from "./listing-refresh.ts";
import { listingRefreshTasks } from "./listing-refresh-tasks.ts";
import {
  createDatabase,
  createIngestionStore,
  normalizeChangedCatalog,
  matchChangedCatalog,
  assertRefreshScope,
  previewListingRefresh,
} from "@comprafino/db";
import { ingest } from "./ingestion.ts";
import { refreshCatalog, parseRefreshOptions } from "./refresh.ts";
import { createRefreshAdapters } from "./refresh-adapters.ts";

try {
  const { dryRun } = parseRefreshOptions(process.argv.slice(2));
  // Validate configuration before making requests. Dry run never opens the DB.
  const db = dryRun ? null : createDatabase();
  const store = db ? createIngestionStore(db) : null;
  const categoryRequests = { tottus: 0, "plaza-vea": 0, metro: 0, makro: 0 };
  const measuredFetch: typeof fetch = (input, init) => {
    const hostname = new URL(input instanceof Request ? input.url : input).hostname;

    if (hostname === "www.tottus.com.pe") {
      categoryRequests.tottus++;
    } else if (hostname === "www.plazavea.com.pe") {
      categoryRequests["plaza-vea"]++;
    } else if (hostname === "www.makro.plazavea.com.pe") {
      categoryRequests.makro++;
    } else if (hostname === "www.metro.pe") {
      categoryRequests.metro++;
    }

    return fetch(input, init);
  };
  const adapters = createRefreshAdapters(measuredFetch);
  const summary = await refreshCatalog(
    {
      async ingest(retailer) {
        const { adapter, limit } = adapters[retailer];

        if (store) return ingest(adapter, limit, store);

        const sample = await adapter.fetchListings(limit);

        return { fetched: sample.discovered, persisted: 0, changed: 0 };
      },
      async targeted() {
        if (!db) {
          throw new Error("Database required");
        }

        return refreshKnownListings(
          await previewListingRefresh(db, {
            limit: listingRefreshPolicy.limit,
            dryRun: false,
            retailer: undefined,
            externalId: undefined,
          }),
          listingRefreshTasks(db),
        );
      },
      async normalize() {
        if (!db) {
          throw new Error("Database required");
        }

        await assertRefreshScope(db);
        const r = await normalizeChangedCatalog(db, 10_000);

        return r;
      },
      async match() {
        if (!db) {
          throw new Error("Database required");
        }

        await assertRefreshScope(db);
        const r = await matchChangedCatalog(db, 250);

        return r;
      },
    },
    dryRun,
    (event) => console.log(JSON.stringify(event)),
  );
  console.log(
    JSON.stringify({ ...summary, observedAt: new Date().toISOString(), categoryRequests }, null, 2),
  );

  console.log(
    JSON.stringify({
      operation: "catalog_capacity",
      skippedByCapacity: summary.retailers.reduce(
        (total, entry) =>
          total +
          (entry.outcome.status === "success" ? (entry.outcome.result.skippedByCapacity ?? 0) : 0),
        0,
      ),
    }),
  );

  if (summary.status === "failed") {
    process.exitCode = 1;
  }
} catch (error) {
  logDiagnostic(error, { stage: "admission", operation: "refresh", reason: "db_read_failed" });
  process.exitCode = 1;
}
