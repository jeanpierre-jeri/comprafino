import { drizzle } from "drizzle-orm/neon-http";
import { z } from "zod";
import * as tables from "../../schema.ts";
import type { transferFixture } from "./fixture.ts";

/** One observer per request; concurrent measurements cannot share counters. */
export function transferObserver(
  client: ReturnType<typeof transferFixture>["scoped"],
  inspectRows?: (rows: unknown[]) => void,
) {
  const metrics = {
    calls: 0,
    statements: 0,
    rows: 0,
    candidates: 0,
    historyRows: 0,
    weekdayRows: 0,
    logicalJsonBytes: 0,
    candidateBytes: 0,
    historyBytes: 0,
    weekdayBytes: 0,
    queryMs: 0,
  };
  const observed = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof target.transaction>) => {
        metrics.calls++;
        const started = performance.now();
        let results;
        try {
          results = await target.transaction(...args);
        } finally {
          metrics.queryMs += performance.now() - started;
        }
        const batches = z.array(z.object({ rows: z.array(z.unknown()) })).parse(results);
        for (const batch of batches) {
          metrics.statements++;
          metrics.rows += batch.rows.length;
          metrics.logicalJsonBytes += Buffer.byteLength(JSON.stringify(batch.rows));
          inspectRows?.(batch.rows);
          for (const row of batch.rows) {
            const snapshot = z
              .object({
                snapshot: z.object({
                  listings: z.array(z.unknown()),
                  historyRows: z.array(z.unknown()),
                  weekdayRows: z.array(z.unknown()),
                }),
              })
              .safeParse(row);
            if (snapshot.success) {
              const value = snapshot.data.snapshot;
              metrics.candidates += value.listings.length;
              metrics.historyRows += value.historyRows.length;
              metrics.weekdayRows += value.weekdayRows.length;
              metrics.candidateBytes += Buffer.byteLength(JSON.stringify(value.listings));
              metrics.historyBytes += Buffer.byteLength(JSON.stringify(value.historyRows));
              metrics.weekdayBytes += Buffer.byteLength(JSON.stringify(value.weekdayRows));
            } else {
              metrics.candidates++;
              metrics.candidateBytes += Buffer.byteLength(JSON.stringify(row));
            }
          }
        }
        return results;
      };
    },
  });
  return { db: drizzle(observed, { schema: tables }), metrics };
}
