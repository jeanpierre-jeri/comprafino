import { expect, it } from "vitest";
import { categoryRequestBudget, workflowCadence, catalogProjection } from "./catalog-budget.ts";
it("accounts for sparse page caps independently of usable observation limits", () => {
  const budget = categoryRequestBudget();
  expect(budget).toMatchObject({
    categorySources: 16,
    observationCap: 590,
    typicalRequests: 27,
    maximumRequests: 98,
  });
  expect(budget.sources.filter((s) => s.maximumRequests === 2)).toHaveLength(12);
});
it("reads actual cron cadence and refuses unsupported or invalid assumptions", () => {
  expect(workflowCadence('cron: "17 11,23 * * *"')).toEqual({
    cron: "17 11,23 * * *",
    runsPerDay: 2,
  });
  expect(workflowCadence('cron: "43 0,6,12,18 * * *"').runsPerDay).toBe(4);
  for (const yaml of ['cron: "0 */6 * * *"', 'cron: "61 1 * * *"', 'cron: "17 23,23 * * *"'])
    expect(() => workflowCadence(yaml)).toThrow(/cadence|Unsupported/u);
});
it("labels quadratic candidate projections and the existing guard", () => {
  expect(catalogProjection(735, 8845, 1470)).toMatchObject({
    matchingCandidateEstimate: 35380,
    derivationLinearFactor: 2,
    currentGuardExceeded: true,
  });
  expect(catalogProjection(735, 8845, 1000).currentGuardExceeded).toBe(false);
  expect(() => catalogProjection(0, 10, 1500)).toThrow("Invalid projection inputs");
});
