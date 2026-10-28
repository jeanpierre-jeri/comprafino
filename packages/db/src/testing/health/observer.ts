import { NeonQueryPromise } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { z } from "zod";
import * as tables from "../../schema.ts";
import type { healthFixture } from "./fixture.ts";

type Client = ReturnType<typeof healthFixture>["scoped"];
type Stage = "operations" | "counts" | "offers_page";

export function healthObserver(client: Client, inspectPage?: (rows: unknown[]) => void) {
  const metrics = {
    calls: 0,
    statements: 0,
    rows: 0,
    logicalJsonBytes: 0,
    queryMs: 0,
    pages: 0,
    candidateRows: 0,
    pageJsonBytes: 0,
  };
  const trace: { stage: Stage; rows: number; bytes: number }[] = [];

  function capture(query: string, result: unknown) {
    let stage: Stage = "operations";
    if (query.includes("jsonb_build_object('id',l.id")) {
      stage = "offers_page";
    } else if (query.includes("group by retailer_id")) {
      stage = "counts";
    }
    const rows = Array.isArray(result)
      ? z.array(z.unknown()).parse(result)
      : z.object({ rows: z.array(z.unknown()) }).parse(result).rows;
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    metrics.statements++;
    metrics.rows += rows.length;
    metrics.logicalJsonBytes += bytes;
    if (stage === "offers_page") {
      metrics.pages++;
      metrics.candidateRows += rows.length;
      metrics.pageJsonBytes += bytes;
      inspectPage?.(rows);
    }
    trace.push({ stage, rows: rows.length, bytes });
  }

  async function timed<T>(read: () => Promise<T>) {
    metrics.calls++;
    const started = performance.now();
    try {
      return await read();
    } finally {
      metrics.queryMs += performance.now() - started;
    }
  }

  const observed = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<typeof client.query>) => {
          const native = target.query(...args);
          return new NeonQueryPromise<boolean, boolean, unknown>(
            async () => {
              const result = await timed(async () => await native);
              capture(args[0], result);
              return result;
            },
            native.queryData,
            native.opts,
          );
        };
      }
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof client.transaction>) => {
        const [queries] = args;
        if (typeof queries === "function") {
          throw new Error("Health observer requires explicit batches");
        }
        const results = await timed(() => target.transaction(...args));
        for (const [index, query] of queries.entries()) {
          const data =
            "query" in query.queryData ? query.queryData : query.queryData.toParameterizedQuery();
          capture(data.query, results[index]);
        }
        return results;
      };
    },
  });

  return { db: drizzle(observed, { schema: tables }), metrics, trace };
}
