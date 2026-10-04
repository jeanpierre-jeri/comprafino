import { describe, expect, it } from "vitest";
import { createDatabase } from "./client.ts";

describe("explicit browser-test schema boundary", () => {
  const DATABASE_URL = "postgresql://unused@localhost/unused";
  it("refuses public, empty-prefix, malformed or SQL-bearing schema overrides before querying", () => {
    for (const schema of [
      "public",
      "comprafino_e2e_",
      "comprafino_e2e_abc;drop schema public cascade",
      "comprafino_e2e_" + "z".repeat(32),
    ]) {
      expect(() => createDatabase({ DATABASE_URL, COMPRAFINO_E2E_SCHEMA: schema })).toThrow(
        /comprafino_e2e/u,
      );
    }
  });
  it("constructs ordinary and strictly isolated clients without opening a connection", () => {
    expect(() => createDatabase({ DATABASE_URL })).not.toThrow(/comprafino_e2e/u);
    expect(() =>
      createDatabase({ DATABASE_URL, COMPRAFINO_E2E_SCHEMA: "comprafino_e2e_" + "a".repeat(32) }),
    ).not.toThrow(/comprafino_e2e/u);
  });
});
