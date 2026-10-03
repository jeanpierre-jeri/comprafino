import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import { canonicalGroupId, matchingPersistenceStatements } from "./matching.ts";
it("parameterizes guarded canonical writes and rejects duplicate input", () => {
  const statements = matchingPersistenceStatements([], []);
  const queries = statements.map((s) => new PgDialect().sqlToQuery(s));
  expect(queries[0]!.sql).toContain("order by id for update");
  expect(queries[2]!.sql).toContain("c.method='automatic'");
  expect(queries[4]!.sql).toContain("on conflict(listing_id) do nothing");
  expect(queries[1]!.sql).toContain("is distinct from x.normalized");
  expect(queries[1]!.params).toContain("[]");
});

it("derives valid version-8 UUIDs from sorted membership, independently of input order", () => {
  const id = canonicalGroupId(["b", "a"]);
  expect(z.uuid().parse(id)).toBe(id);
  expect(id[14]).toBe("8");
  expect(canonicalGroupId(["a", "b"])).toBe(id);
  expect(canonicalGroupId(["a", "c"])).not.toBe(id);
});
