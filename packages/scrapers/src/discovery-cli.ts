import {
  createDatabase,
  claimDiscoveryQueries,
  previewDiscoveryQueries,
  finishDiscoveryQuery,
  inspectDiscovery,
  persistListingsDetailed,
  normalizeCatalog,
  matchCatalog,
  assertRefreshScope,
  parseDiscoveryOptions,
} from "@comprafino/db";
import { processDiscoveryQuery } from "./discovery.ts";
import { createTottusAdapter } from "./tottus.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";

try {
  const { limit, dryRun } = parseDiscoveryOptions(process.argv.slice(2));
  const db = createDatabase();
  const { stats } = await inspectDiscovery(db);
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun,
          ...stats,
          eligible: await previewDiscoveryQueries(db, limit),
          retailerSearchCalls: 0,
          writes: 0,
        },
        null,
        2,
      ),
    );
  } else {
    // Guard before reserving any work, then again before downstream writes.
    await assertRefreshScope(db);
    const claims = await claimDiscoveryQueries(db, limit);
    const results: Awaited<ReturnType<typeof processDiscoveryQuery>>[] = [];
    const tasks = {
      adapters: [createTottusAdapter(), createPlazaVeaAdapter(), createMetroAdapter()],
      persist: (
        retailer: Parameters<typeof persistListingsDetailed>[1],
        rows: Parameters<typeof persistListingsDetailed>[2],
      ) => persistListingsDetailed(db, retailer, rows),
      async normalize() {
        await assertRefreshScope(db);
        const r = await normalizeCatalog(db, 1000);
        if (!r.persisted || r.persisted.stale) throw new Error("Stale normalization");
        return r.persisted.changed;
      },
      async match() {
        await assertRefreshScope(db);
        const r = await matchCatalog(db, 1000);
        if (!r.persisted || r.persisted.stale) throw new Error("Stale matching");
        return {
          writes:
            r.persisted.linksCreated +
            r.persisted.linksRemoved +
            r.persisted.productsCreated +
            r.persisted.productsUpdated +
            r.persisted.productsRemoved,
          created: r.persisted.productsCreated,
        };
      },
      finish: (
        claim: Parameters<typeof finishDiscoveryQuery>[1],
        outcome: Parameters<typeof finishDiscoveryQuery>[2],
      ) => finishDiscoveryQuery(db, claim, outcome),
    };
    for (const claim of claims) {
      const result = await processDiscoveryQuery(claim, tasks);
      results.push(result);
      console.log(JSON.stringify(result));
    }
    const metric = (
      key:
        | "retailerSearchCalls"
        | "listingsDiscovered"
        | "newListings"
        | "normalizationWrites"
        | "matchingWrites"
        | "canonicalGroupsCreated",
    ) => results.reduce((n, r) => n + r[key], 0);
    console.log(
      JSON.stringify(
        {
          dryRun,
          queriesProcessed: claims.length,
          queriesSkippedByCooldown: stats.cooldown,
          processedToday: (await inspectDiscovery(db)).stats.processedToday,
          retailerSearchCalls: metric("retailerSearchCalls"),
          listingsDiscovered: metric("listingsDiscovered"),
          newListings: metric("newListings"),
          normalizationWrites: metric("normalizationWrites"),
          matchingWrites: metric("matchingWrites"),
          canonicalGroupsCreated: metric("canonicalGroupsCreated"),
        },
        null,
        2,
      ),
    );
    if (results.some((r) => r.status === "failed" || r.status === "partial")) process.exitCode = 1;
  }
} catch {
  console.error(
    "Catalog discovery failed. Check options, DATABASE_URL, migrations and complete catalog scope; no credentials logged.",
  );
  process.exitCode = 1;
}
