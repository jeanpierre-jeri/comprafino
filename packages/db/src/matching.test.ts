import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { matchingPersistenceStatements } from "./matching.ts";

it("parameterizes guarded canonical writes", () => {
  const statements = matchingPersistenceStatements([], []);
  const queries = statements.map((s) => new PgDialect().sqlToQuery(s));
  expect(queries[0]!.sql).toContain("order by id for update");
  expect(queries[2]!.sql).toContain("c.method='automatic'");
  expect(queries[4]!.sql).toContain("on conflict(listing_id) do update");
  expect(queries[1]!.sql).toContain("is distinct from x.normalized");
  expect(queries[1]!.params).toContain("[]");
});
