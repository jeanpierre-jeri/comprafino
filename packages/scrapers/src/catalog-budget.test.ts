import { readFileSync } from "node:fs";
import { refreshMeasurementEvidence, sourceConfigurationIdentity } from "./catalog-budget.ts";
import { expect, it } from "vitest";
import { categoryRequestBudget, workflowCadence, catalogProjection } from "./catalog-budget.ts";

it("accounts for sparse page caps independently of usable observation limits", () => {
  const budget = categoryRequestBudget();
  expect(budget).toMatchObject({
    categorySources: 17,
    observationCap: 600,
    typicalRequests: 28,
    maximumRequests: 100,
  });
  expect(budget.sources.filter((s) => s.maximumRequests === 2)).toHaveLength(13);
});

it("reads actual cron cadence and refuses unsupported or invalid assumptions", () => {
  expect(workflowCadence('cron: "17 11,23 * * *"')).toEqual({
    cron: "17 11,23 * * *",
    runsPerDay: 2,
  });
  expect(workflowCadence('cron: "43 0,6,12,18 * * *"').runsPerDay).toBe(4);

  for (const yaml of ['cron: "0 */6 * * *"', 'cron: "61 1 * * *"', 'cron: "17 23,23 * * *"']) {
    expect(() => workflowCadence(yaml)).toThrow(/cadence|Unsupported/u);
  }
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

it("qualifies recorded evidence by date, full source identity and catalog size", () => {
  const value = {
    observedAt: "2026-10-05T16:16:09.636Z",
    status: "success",
    durationMs: 99840,
    targeted: { status: "success", result: { requests: 0 } },
    provenance: {
      baselineCommit: "c3e5eb7",
      sourceConfigurationIdentity: sourceConfigurationIdentity(),
      categorySources: 17,
      catalogListings: 952,
      note: "Worktree measurement, exact revision unknown",
    },
  };
  expect(refreshMeasurementEvidence(value, 952)).toMatchObject({
    comparable: true,
    sourceScopeMatches: true,
  });
  expect(refreshMeasurementEvidence(value, 953)).toMatchObject({
    comparable: false,
    catalogSizeMatches: false,
  });
  expect(refreshMeasurementEvidence({ ...value, status: "failed" }, 952)).toMatchObject({
    comparable: false,
    successfulRun: false,
  });
  expect(
    refreshMeasurementEvidence(
      {
        ...value,
        provenance: { ...value.provenance, sourceConfigurationIdentity: "old-scopes-same-count" },
      },
      952,
    ),
  ).toMatchObject({ comparable: false, sourceScopeMatches: false });
  const { provenance: _provenance, ...legacy } = value;
  expect(refreshMeasurementEvidence(legacy, 952)).toMatchObject({
    classification: "historical-non-comparable",
  });
  const { observedAt: _observedAt, ...undated } = value;
  expect(refreshMeasurementEvidence(undated, 952).comparable).toBe(false);
  expect(() => refreshMeasurementEvidence({ ...value, durationMs: -1 }, 952)).toThrow(/Too small/u);
});

it("preserves the recorded runtime evidence and checks its source attribution", () => {
  const value: unknown = JSON.parse(
    readFileSync(
      new URL("../../../docs/catalog-refresh-measurement.json", import.meta.url),
      "utf8",
    ),
  );
  expect(refreshMeasurementEvidence(value, 952)).toMatchObject({
    sourceScopeMatches: true,
    comparable: true,
  });
});
