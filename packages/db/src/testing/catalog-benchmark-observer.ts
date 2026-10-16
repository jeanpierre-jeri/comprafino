import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/neon-http";
import { z } from "zod";
import type { ownedTestDatabase } from "./database.ts";
import * as tables from "../schema.ts";

type Harness = ReturnType<typeof ownedTestDatabase>;
type Statement = { query: string; params: unknown[] };
export function benchmarkFailure(error: unknown) {
  const parsed = z.object({ message: z.string(), code: z.string().optional() }).safeParse(error);
  return parsed.success ? parsed.data : { message: "Unknown benchmark error" };
}

type Capture = {
  dbErrors: ReturnType<typeof benchmarkFailure>[];
  dbWaitMs: number;
  statements: Statement[];
  rows: number;
  candidateRows: number;
  weekdayRows: number;
  jsonBytes: number;
  capture: boolean;
};

/** Observes only this injected test client. Never patches the production boundary. */
export function catalogBenchmarkObserver(harness: Harness) {
  const storage = new AsyncLocalStorage<Capture>();
  const client = new Proxy(harness.scoped, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof target.transaction>) => {
        const context = storage.getStore();
        const started = performance.now();
        const results = await target
          .transaction(...args)
          .catch((error: unknown) => {
            context?.dbErrors.push(benchmarkFailure(error));
            throw error;
          })
          .finally(() => {
            if (context) {
              context.dbWaitMs += performance.now() - started;
            }
          });
        if (context) {
          if (context.capture) {
            const [queries] = args;
            if (typeof queries === "function") {
              throw new Error("Benchmark requires explicit query batches");
            }
            for (const q of queries) {
              const data =
                "query" in q.queryData ? q.queryData : q.queryData.toParameterizedQuery();
              context.statements.push({ query: data.query, params: data.params });
            }
            const batches = z.array(z.object({ rows: z.array(z.unknown()) })).parse(results);
            for (const batch of batches) {
              context.rows += batch.rows.length;
              context.jsonBytes += Buffer.byteLength(JSON.stringify(batch.rows));
              for (const row of batch.rows) {
                const snapshot = z
                  .object({
                    snapshot: z.object({
                      listings: z.array(z.unknown()),
                      weekdayRows: z.array(z.unknown()),
                    }),
                  })
                  .safeParse(row);
                if (snapshot.success) {
                  context.candidateRows += snapshot.data.snapshot.listings.length;
                  context.weekdayRows += snapshot.data.snapshot.weekdayRows.length;
                } else {
                  context.candidateRows++;
                }
              }
            }
          }
        }
        return results;
      };
    },
  });
  const db = drizzle(client, { schema: tables });
  async function observe<T>(operation: () => Promise<T>, capture = false) {
    const metrics: Capture = {
      dbErrors: [],
      dbWaitMs: 0,
      statements: [],
      rows: 0,
      candidateRows: 0,
      weekdayRows: 0,
      jsonBytes: 0,
      capture,
    };
    return storage.run(metrics, async () => {
      const start = performance.now();
      const result = await operation();
      return { result, totalMs: performance.now() - start, metrics };
    });
  }
  async function explain(statements: Statement[]) {
    const results = [];
    for (const statement of statements) {
      const plan = await harness.scoped.query(
        `explain (analyze,buffers,format json) ${statement.query}`,
        statement.params,
      );
      results.push({ ...statement, plan });
    }
    return results;
  }
  return { db, observe, explain };
}
