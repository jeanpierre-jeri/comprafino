import { catalogPolicy, catalogRunFailureKind } from "@comprafino/core";
import { and, count, desc, eq } from "drizzle-orm";
import { operationalRunSchema, retailerFreshness, retailerIdSchema } from "@comprafino/core";
import { createDatabase } from "./client.ts";
import { ingestionRuns, retailerListings } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>;

export async function assertRefreshScope(db: Database) {
  const [result] = await db.select({ total: count() }).from(retailerListings);

  if (!result || result.total > catalogPolicy.retainedListingCap) {
    throw new Error("Refresh exceeds validated downstream bound");
  }
}

export async function inspectOperations(
  db = createDatabase(),
  now = new Date(),
  sequential = false,
) {
  const inspectRetailer = async (retailer: (typeof retailerIdSchema.options)[number]) => {
    // Query each retailer independently; a global latest-N window can hide failures.
    const [attempts, successes] = await db.batch([
      db
        .select()
        .from(ingestionRuns)
        .where(eq(ingestionRuns.retailerId, retailer))
        .orderBy(desc(ingestionRuns.startedAt), desc(ingestionRuns.id))
        .limit(1),
      db
        .select()
        .from(ingestionRuns)
        .where(and(eq(ingestionRuns.retailerId, retailer), eq(ingestionRuns.status, "success")))
        .orderBy(desc(ingestionRuns.startedAt), desc(ingestionRuns.id))
        .limit(1),
    ]);

    return {
      retailer,
      ...retailerFreshness(
        attempts[0]
          ? operationalRunSchema.parse({
              ...attempts[0],
              failureKind: catalogRunFailureKind(attempts[0].error),
            })
          : null,
        successes[0] ? operationalRunSchema.parse(successes[0]) : null,
        now,
      ),
    };
  };
  if (sequential) {
    const operations = [];
    for (const retailer of retailerIdSchema.options) {
      operations.push(await inspectRetailer(retailer));
    }
    return operations;
  }
  return Promise.all(retailerIdSchema.options.map(inspectRetailer));
}

export { freshnessHours } from "@comprafino/core";
