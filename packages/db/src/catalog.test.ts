import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { catalogFingerprint, catalogPersistenceStatements } from "./catalog.ts";
import { parseCatalogOptions } from "./catalog-options.ts";
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  retailerId: "metro",
  title: "Leche Gloria 390g",
  priceUnit: "UN",
} as const;
it("validates bounded CLI options before accessing the database", () => {
  expect(parseCatalogOptions(["--", "--limit=50", "--retailer=metro", "--dry-run"])).toEqual({
    limit: 50,
    retailer: "metro",
    dryRun: true,
  });
  expect(parseCatalogOptions([]).limit).toBe(100);
  for (const args of [
    ["--limit=0"],
    ["--limit=5001"],
    ["--limit=1.5"],
    ["--retailer=unknown"],
    ["--all"],
    ["--limit=1", "--limit=2"],
  ])
    expect(() => parseCatalogOptions(args)).toThrow(/.+/u);
});
it("fingerprints source attributes only with stable null/missing representation", () => {
  expect(catalogFingerprint(row)).toBe(
    catalogFingerprint({ ...row, packageText: null, sourceBrand: null }),
  );
  expect(catalogFingerprint(row)).not.toBe(
    catalogFingerprint({ ...row, title: "Leche Gloria 946ml" }),
  );
  expect(catalogFingerprint(row)).not.toBe(catalogFingerprint({ ...row, sourceBrand: "Gloria" }));
});
it("parameterizes a bounded batch, uses ordered ingestion locks and refuses stale inputs", () => {
  const queries = catalogPersistenceStatements([row]).map((s) => new PgDialect().sqlToQuery(s));
  expect(queries[0]?.sql).toContain("order by id for update");
  expect(queries[2]?.sql).toContain("is not distinct from");
  expect(queries[2]?.sql).toContain("is distinct from");
  expect(queries[2]?.sql).not.toContain(row.title);
  expect(queries[2]?.params[0]).toContain(row.title);
  expect(() => catalogPersistenceStatements([row, row])).toThrow("Duplicate catalog");
  expect(() => catalogPersistenceStatements([])).toThrow("Empty catalog");
});
