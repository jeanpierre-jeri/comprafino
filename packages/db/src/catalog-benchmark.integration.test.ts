import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ownedTestDatabase } from "./testing/database.ts";
import { catalogBenchmarkObserver } from "./testing/catalog-benchmark-observer.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("benchmark observation in owned PostgreSQL", () => {
  const harness = ownedTestDatabase();
  const observer = catalogBenchmarkObserver(harness);

  beforeAll(() => harness.setup(), 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("keeps concurrent success/failure metrics separate and records SQLSTATE before handler recovery", async () => {
    const operations = [sql`select 1 as value`, sql`select 1 / 0 as value`, sql`select 2 as value`];
    const results = await Promise.all(
      operations.map((statement) =>
        observer.observe(async () => {
          try {
            await observer.db.batch([observer.db.execute(statement)]);
            return 200;
          } catch {
            return 503;
          }
        }, true),
      ),
    );

    expect(results.map((result) => result.result)).toEqual([200, 503, 200]);
    expect(results[0]!.metrics.dbErrors).toEqual([]);
    expect(results[2]!.metrics.dbErrors).toEqual([]);
    expect(results[1]!.metrics.dbErrors).toEqual([
      expect.objectContaining({
        code: "22012",
        message: expect.stringContaining("division by zero"),
      }),
    ]);
    expect(results[1]!.metrics.dbWaitMs).toBeGreaterThan(0);
    expect(results[1]!.metrics.rows).toBe(0);
    for (const index of [0, 2]) {
      expect(results[index]!.metrics.rows).toBe(1);
      expect(results[index]!.metrics.statements).toHaveLength(1);
      expect(results[index]!.metrics.jsonBytes).toBeGreaterThan(0);
    }
    // Rollback and the other concurrent transactions have all finished; reuse is safe.
    expect((await harness.scoped.query("select 3 as value"))[0]?.value).toBe(3);
  });
});
