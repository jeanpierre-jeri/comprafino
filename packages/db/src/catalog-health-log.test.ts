import { expect, it } from "vitest";
import { readCatalogCapacityLog } from "./catalog-health-log.ts";

it("reads the explicit marker among events and multiline acquisition summaries", () => {
  expect(
    readCatalogCapacityLog(
      'pnpm output\n{"stage":"overall","status":"success"}\n{\n  "fetched": 20\n}\n{"operation":"catalog_capacity","skippedByCapacity":3}\n',
    ),
  ).toBe(3);
  expect(readCatalogCapacityLog('{"operation":"catalog_capacity","skippedByCapacity":0}\n')).toBe(
    0,
  );
});

it("does not infer capacity skips from missing summaries, duplicate markers or malformed values", () => {
  for (const input of [
    '{"fetched":20,"persisted":10}',
    '{"operation":"catalog_capacity","skippedByCapacity":-1}',
    '{"operation":"catalog_capacity","skippedByCapacity":"3"}',
    '{"operation":"catalog_capacity","skippedByCapacity":',
    '{"operation":"catalog_capacity","skippedByCapacity":0}\n{"operation":"catalog_capacity","skippedByCapacity":1}',
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    expect(() => readCatalogCapacityLog(input)).toThrow(/.+/u);
  }
});
