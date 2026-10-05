import { fixtureDatabaseUrl } from "./testing/fixture-url.ts";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)("production Neon through the explicit fixture preload", () => {
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: testUrl ?? "postgresql://unused@localhost/comprafino_test",
  });
  beforeAll(async () => {
    await harness.setup();
  }, 30_000);
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  });
  it("scopes direct/batched queries, preserves raw result parsing and rollback, rejects unowned URLs", async () => {
    const script = `
      import assert from 'node:assert/strict';
      const { createDatabase } = await import(${JSON.stringify(new URL("./client.ts", import.meta.url).href)});
      const db = createDatabase();
      const client = db.$client;
      assert.equal((await client.query('select current_schema() as schema'))[0]?.schema, process.env.COMPRAFINO_E2E_SCHEMA);
      await client.query('create table transport_fixture(value integer check(value>0))');
      const results = await client.transaction([
        client.query('insert into transport_fixture values($1)', [1]),
        client.query('select value, true as flag, array[1,2] as items from transport_fixture')
      ]);
      assert.deepEqual(results[1], [{value:1,flag:true,items:[1,2]}]);
      await assert.rejects(client.transaction([
        client.query('insert into transport_fixture values(2)'),
        client.query('insert into transport_fixture values(-1)')
      ]));
      assert.deepEqual(await client.query('select value from transport_fixture'), [{value:1}]);
      const wrong = new URL(process.env.DATABASE_URL); wrong.pathname='/unowned';
      await assert.rejects(createDatabase({DATABASE_URL:wrong.href}).$client.query('select 1'));
    `;
    const child = spawn(
      process.execPath,
      [
        "--import",
        new URL("./testing/http-preload.ts", import.meta.url).href,
        "--input-type=module",
        "-e",
        script,
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: fixtureDatabaseUrl(harness.url, process.env.COMPRAFINO_TEST_DATABASE_MODE),
          COMPRAFINO_E2E_SCHEMA: harness.schema,
        },
        // Do not expose raw driver/assertion details; the exit status fails this check.
        stdio: "ignore",
      },
    );
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (value) => resolve(value ?? 1));
    });
    expect(code).toBe(0);
  }, 30_000);
});
