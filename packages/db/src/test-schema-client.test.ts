import { describe, expect, it } from "vitest";
import { createDatabase } from "./client.ts";
import { neon } from "@neondatabase/serverless";
import { testSchemaClient } from "./testing/test-schema-client.ts";

describe("explicit browser-test schema boundary", () => {
  const DATABASE_URL = "postgresql://unused@localhost/unused";
  it("refuses public, empty-prefix, malformed or SQL-bearing schema overrides before querying", () => {
    for (const schema of [
      "public",
      "comprafino_e2e_",
      "comprafino_e2e_abc;drop schema public cascade",
      "comprafino_e2e_" + "z".repeat(32),
    ]) {
      expect(() => testSchemaClient(neon(DATABASE_URL), schema)).toThrow(/comprafino_/u);
    }
  });
  it("production clients ignore test mode/schema variables and retain ordinary Neon", () => {
    const db = createDatabase({
      DATABASE_URL,
      COMPRAFINO_TEST_DATABASE_MODE: "local",
      COMPRAFINO_E2E_SCHEMA: "public",
    });
    expect(db.$client).toBeTypeOf("function");
  });
  it("constructs ordinary and strictly isolated clients without opening a connection", () => {
    expect(() => createDatabase({ DATABASE_URL })).not.toThrow(/comprafino_/u);
    expect(() =>
      testSchemaClient(neon(DATABASE_URL), "comprafino_e2e_" + "a".repeat(32)),
    ).not.toThrow(/comprafino_/u);
  });
});

it("fixture mutations require explicit test configuration and a validated parent schema", async () => {
  const { fixtureDatabase } = await import("./testing/fixture-client.ts");
  expect(() =>
    fixtureDatabase({
      DATABASE_URL: "postgresql://unused@localhost/comprafino_test",
      COMPRAFINO_E2E_SCHEMA: "comprafino_e2e_" + "a".repeat(32),
    }),
  ).toThrow(/DATABASE_URL/u);
  expect(() =>
    fixtureDatabase({
      TEST_DATABASE_URL: "postgresql://unused@localhost/comprafino_test",
      COMPRAFINO_E2E_SCHEMA: "public",
    }),
  ).toThrow(/comprafino_/u);
});
