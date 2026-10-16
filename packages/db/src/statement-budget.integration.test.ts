import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import { withStatementBudget } from "./statement-budget.ts";
import { abortableFixtureFetch } from "./testing/abortable-fixture-fetch.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("statement budgets in owned PostgreSQL", () => {
  const harness = ownedTestDatabase();
  const client = withStatementBudget(harness.scoped, 150);
  const db = drizzle(client);

  beforeAll(async () => {
    await harness.setup();
    await harness.scoped.query("create table budget_writes (value integer not null)");
  }, 30_000);

  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  }, 30_000);

  it("cancels a slow statement with SQLSTATE 57014, restores settings and recovers", async () => {
    const before = await harness.scoped.query("show statement_timeout");
    const started = performance.now();
    await expect(client.query("select pg_sleep(2)")).rejects.toMatchObject({ code: "57014" });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(await harness.scoped.query("show statement_timeout")).toEqual(before);
    expect((await db.execute(sql`select 7 as value`)).rows).toEqual([{ value: 7 }]);
  });

  it("preserves a stricter PostgreSQL timeout instead of relaxing existing protection", async () => {
    const strict = withStatementBudget(withStatementBudget(harness.scoped, 50), 150);
    expect(await strict.query("show statement_timeout")).toEqual([{ statement_timeout: "50ms" }]);
    expect(await client.query("show statement_timeout")).toEqual([{ statement_timeout: "150ms" }]);
  });

  it("rolls back earlier writes when a later statement in the same batch times out", async () => {
    await expect(
      db.batch([
        db.execute(sql`insert into budget_writes values (1)`),
        db.execute(sql`select pg_sleep(2)`),
      ]),
    ).rejects.toMatchObject({ code: "57014" });
    expect(await harness.scoped.query("select * from budget_writes")).toEqual([]);
    const result = await db.batch([
      db.execute(sql`select 1 as value`),
      db.execute(sql`select 2 as value`),
    ]);
    expect(result.map((entry) => entry.rows)).toEqual([[{ value: 1 }], [{ value: 2 }]]);
  });

  it("HTTP cancellation can precede SQL cancellation; SQL still ends at its own budget", async () => {
    let settled = false;
    const underlying = Promise.resolve(client.query("select pg_sleep(2)")).finally(() => {
      settled = true;
    });
    const signal = AbortSignal.timeout(20);
    await expect(abortableFixtureFetch(underlying, signal)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(settled).toBe(false);
    await expect(underlying).rejects.toMatchObject({ code: "57014" });
    expect((await client.query("select 9 as value"))[0]?.value).toBe(9);
  });

  it("recovers after four concurrent canceled SQL statements on the same bounded pool", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => client.query("select pg_sleep(2)")),
    );
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toMatchObject({ status: "rejected", reason: { code: "57014" } });
    }
    const recovered = await Promise.all(
      Array.from({ length: 4 }, () => client.query("select 11 as value")),
    );
    expect(recovered.map((rows) => rows[0]?.value)).toEqual([11, 11, 11, 11]);
  });
});
