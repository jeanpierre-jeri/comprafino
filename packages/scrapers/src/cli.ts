import { createIngestionStore } from "@comprafino/db";
import { createTottusAdapter } from "./tottus.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";
import { ingest } from "./ingestion.ts";

import { parseArguments } from "./cli-options.ts";
async function main() {
  const { dryRun, limit, retailer, category } = parseArguments(process.argv.slice(2));
  const adapters = {
    tottus: createTottusAdapter,
    "plaza-vea": createPlazaVeaAdapter,
    metro: createMetroAdapter,
  };
  const adapter =
    retailer === "tottus"
      ? createTottusAdapter(undefined, category === "dairy" ? "dairy" : "meat")
      : adapters[retailer](undefined, category);
  if (dryRun) {
    const result = await adapter.fetchListings(limit);
    console.log(
      JSON.stringify(
        {
          retailer,
          dryRun,
          discovered: result.discovered,
          normalized: result.listings.length,
          sample: result.listings.slice(0, 5),
        },
        null,
        2,
      ),
    );
  } else {
    // Validate the DB before any live requests. Never silently switch to dry-run.
    if (!process.env.DATABASE_URL)
      throw new Error(
        "DATABASE_URL is required for persisted ingestion; use --dry-run to inspect without PostgreSQL",
      );
    console.log(JSON.stringify(await ingest(adapter, limit, createIngestionStore())));
  }
}
await main().catch((error: unknown) => {
  // Only print safe local/source messages, never arbitrary database driver errors.
  const message =
    error instanceof Error &&
    /^(DATABASE_URL|Usage:|Limit must|Tottus HTTP|Tottus public|Tottus pagination|Tottus returned|Plaza Vea HTTP|Plaza Vea pagination|Plaza Vea returned|Metro HTTP|Metro pagination|Metro returned|Unexpected (?:Tottus|Plaza Vea|Metro)|Ambiguous)/u.test(
      error.message,
    )
      ? error.message
      : "Retailer ingestion failed (network, source validation or database); no credentials logged.";
  console.error(message);
  process.exitCode = 1;
});
