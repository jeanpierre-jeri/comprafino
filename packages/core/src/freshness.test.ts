import { expect, it } from "vitest";
import { retailerFreshness, operationalRunSchema, safeIngestionError } from "./freshness.ts";
import type { OperationalRun } from "./freshness.ts";
const now = new Date("2026-10-03T23:00:00Z");
function run(hours: number, status: OperationalRun["status"] = "success"): OperationalRun {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    retailerId: "metro",
    startedAt: new Date(now.getTime() - hours * 3_600_000),
    endedAt: now,
    status,
    listingsFetched: 120,
    listingsPersisted: 100,
    listingsChanged: 0,
  };
}
it.each([
  [0, "healthy"],
  [18, "healthy"],
  [18.01, "delayed"],
  [30, "delayed"],
  [30.01, "stale"],
])("classifies a last success aged %s hours as %s", (hours, expected) => {
  const success = run(hours);
  expect(retailerFreshness(success, success, now).freshness).toBe(expected);
});
it("keeps latest failed attempt distinct from successful observation age and counts", () => {
  const result = retailerFreshness(run(1, "failed"), run(24), now);
  expect(result).toMatchObject({
    freshness: "delayed",
    ageHours: 24,
    latestAttemptStatus: "failed",
    latestFailure: safeIngestionError,
  });
  expect(result.latestSuccess?.status).toBe("success");
});
it("handles missing history and interrupted running attempts", () => {
  expect(retailerFreshness(null, null, now)).toMatchObject({
    freshness: "unknown",
    ageHours: null,
    latestAttemptStatus: null,
  });
  expect(retailerFreshness(run(1, "running"), run(31), now)).toMatchObject({
    freshness: "stale",
    latestAttemptStatus: "running",
    latestFailure: null,
  });
});
it("rejects invalid database operational values and strips arbitrary stored errors", () => {
  expect(() => operationalRunSchema.parse({ ...run(1), status: "oops" })).toThrow(
    /Invalid|Too small/u,
  );
  expect(() => operationalRunSchema.parse({ ...run(1), listingsChanged: -1 })).toThrow(
    /Invalid|Too small/u,
  );
  const parsed = operationalRunSchema.parse({
    ...run(1, "failed"),
    error: "postgres://password@internal/secret",
  });
  expect(JSON.stringify(retailerFreshness(parsed, null, now))).not.toContain("password");
});
