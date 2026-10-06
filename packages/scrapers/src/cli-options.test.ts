import { expect, it } from "vitest";
import { parseArguments } from "./cli-options.ts";

it("selects only the observed allowlisted dairy category and preserves existing defaults", () => {
  expect(parseArguments([])).toEqual({
    retailer: "tottus",
    limit: 20,
    dryRun: false,
    category: undefined,
  });
  expect(parseArguments(["--", "--category=dairy", "--limit=100"])).toEqual({
    retailer: "tottus",
    limit: 100,
    dryRun: false,
    category: "dairy",
  });
  expect(() => parseArguments(["--category=https://example.com"])).toThrow("Usage:");
});
