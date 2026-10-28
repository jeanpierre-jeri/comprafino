import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import * as current from "./generic-offers.ts";
import * as previous from "./testing/search-transfer/legacy-generic-offers.ts";
import { transferNow as now } from "./testing/transfer/fixture.ts";

it("keeps the shared health/list SQL projections and default relation byte-for-byte unchanged", () => {
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(current.genericOfferProjection)).toEqual(
    dialect.sqlToQuery(previous.genericOfferProjection),
  );
  for (const source of ["history", "snapshot"] as const) {
    for (const category of [null, "lacteos-huevos"] as const) {
      for (const membership of [null, "abarrotes"] as const) {
        expect(
          dialect.sqlToQuery(current.currentGenericOfferRows(now, category, source, membership)),
        ).toEqual(
          dialect.sqlToQuery(previous.currentGenericOfferRows(now, category, source, membership)),
        );
      }
    }
  }
});
