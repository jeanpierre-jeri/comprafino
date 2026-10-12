import type { SafeDiagnostic } from "./diagnostics.ts";

/** Useful partial source work is degraded; admission, writes and access restrictions remain fatal. */
export function catalogFailureSeverity(diagnostic: SafeDiagnostic, useful: boolean) {
  if (
    !useful ||
    diagnostic.stage !== "source" ||
    diagnostic.reason === "db_read_failed" ||
    diagnostic.reason === "db_write_failed" ||
    (diagnostic.httpStatus !== undefined && [401, 403, 429].includes(diagnostic.httpStatus)) ||
    diagnostic.sourceResponseCode === "access_restricted"
  ) {
    return "error" as const;
  }
  return "warning" as const;
}

export function catalogRunFailureKind(error: string | null | undefined) {
  switch (error) {
    case "catalog_partial_source":
      return "partial_source" as const;
    case "catalog_access_restricted":
      return "access_restricted" as const;
    case "catalog_persistence_failed":
      return "persistence_failed" as const;
    case "catalog_capacity_skips":
      return "capacity_skips" as const;
    default:
      return undefined;
  }
}
