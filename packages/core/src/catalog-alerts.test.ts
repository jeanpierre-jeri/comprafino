import { expect, it } from "vitest";
import { catalogFailureSeverity, catalogRunFailureKind } from "./catalog-alerts.ts";
import type { SafeDiagnostic } from "./diagnostics.ts";

const source: SafeDiagnostic = {
  stage: "source",
  operation: "ingestion",
  reason: "source_request_failed",
  message: "safe",
};

it("warns for useful source failures, but keeps zero useful work, access and writes fatal", () => {
  expect(catalogFailureSeverity(source, true)).toBe("warning");
  expect(catalogFailureSeverity(source, false)).toBe("error");
  expect(catalogFailureSeverity({ ...source, httpStatus: 403 }, true)).toBe("error");
  expect(catalogFailureSeverity({ ...source, reason: "db_write_failed" }, true)).toBe("error");
  expect(catalogFailureSeverity({ ...source, sourceResponseCode: "access_restricted" }, true)).toBe(
    "error",
  );
  expect(catalogFailureSeverity({ ...source, stage: "persistence" }, true)).toBe("error");
  expect(catalogFailureSeverity({ ...source, stage: "completion" }, true)).toBe("error");
});

it("classifies only exact run markers and never trusts historical arbitrary text", () => {
  expect(catalogRunFailureKind("catalog_partial_source")).toBe("partial_source");
  expect(catalogRunFailureKind("catalog_access_restricted")).toBe("access_restricted");
  expect(catalogRunFailureKind("catalog_persistence_failed")).toBe("persistence_failed");
  expect(catalogRunFailureKind("catalog_capacity_skips")).toBe("capacity_skips");
  expect(catalogRunFailureKind("private SQL and credentials")).toBeUndefined();
});
