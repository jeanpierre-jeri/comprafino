import { z } from "zod";
import { catalogPolicy } from "./catalog-policy.ts";
import { operationalRunSchema, retailerFreshness } from "./freshness.ts";
import { retailerIdSchema } from "./listing.ts";

const count = z.number().int().nonnegative().safe();

export const catalogHealthSnapshotSchema = z
  .object({
    retainedListings: count,
    // Null means no acquisition log was supplied, never a measured zero.
    skippedByCapacity: count.nullable(),
    retailers: z
      .array(
        z.object({
          retailer: retailerIdSchema,
          known: count,
          freshSearchableOffers: count,
          latestAttempt: operationalRunSchema.nullable(),
          latestSuccess: operationalRunSchema.nullable(),
        }),
      )
      .length(retailerIdSchema.options.length),
  })
  .superRefine((snapshot, context) => {
    const identifiers = snapshot.retailers.map((row) => row.retailer);
    if (
      new Set(identifiers).size !== retailerIdSchema.options.length ||
      snapshot.retailers.reduce((total, row) => total + row.known, 0) !==
        snapshot.retainedListings ||
      snapshot.retailers.some(
        (row) =>
          row.freshSearchableOffers > row.known ||
          (row.latestAttempt && row.latestAttempt.retailerId !== row.retailer) ||
          (row.latestSuccess &&
            (row.latestSuccess.retailerId !== row.retailer ||
              row.latestSuccess.status !== "success")),
      )
    ) {
      context.addIssue({ code: "custom", message: "Inconsistent catalog health snapshot" });
    }
  });

export type CatalogHealthSnapshot = z.infer<typeof catalogHealthSnapshotSchema>;

type HealthIssue = {
  severity: "error" | "warning";
  reason:
    | "refresh_overdue"
    | "latest_attempt_failed"
    | "no_fresh_searchable_offers"
    | "catalog_overflow"
    | "catalog_full"
    | "capacity_skips";
  retailer: z.infer<typeof retailerIdSchema> | null;
};

/** Monitoring only: never changes purchase eligibility, acquisition or retained capacity. */
export function evaluateCatalogHealth(input: unknown, now = new Date()) {
  const snapshot = catalogHealthSnapshotSchema.parse(input);
  if (
    !Number.isFinite(now.getTime()) ||
    snapshot.retailers.some((row) =>
      [row.latestAttempt, row.latestSuccess].some((run) => run && run.startedAt > now),
    )
  ) {
    throw new Error("Invalid catalog health observation time");
  }

  const issues: HealthIssue[] = [];
  const retailers = snapshot.retailers.map((row) => {
    const health = retailerFreshness(row.latestAttempt, row.latestSuccess, now);
    if (health.freshness === "unknown" || health.freshness === "stale") {
      issues.push({ severity: "error", reason: "refresh_overdue", retailer: row.retailer });
    }
    if (health.latestAttemptStatus === "failed") {
      issues.push({ severity: "error", reason: "latest_attempt_failed", retailer: row.retailer });
    }
    // The existing search boundary enforces 36-hour quote freshness, current
    // normalization, positive ordinary price and tri-state stock eligibility.
    if (row.freshSearchableOffers === 0) {
      issues.push({
        severity: "error",
        reason: "no_fresh_searchable_offers",
        retailer: row.retailer,
      });
    }
    return {
      retailer: row.retailer,
      known: row.known,
      freshSearchableOffers: row.freshSearchableOffers,
      latestAttemptStatus: health.latestAttemptStatus,
      lastSuccessfulAttemptAt: row.latestSuccess?.startedAt.toISOString() ?? null,
      ageHours: health.ageHours,
      freshness: health.freshness,
    };
  });

  if (snapshot.retainedListings > catalogPolicy.retainedListingCap) {
    issues.push({ severity: "error", reason: "catalog_overflow", retailer: null });
  } else if (snapshot.retainedListings === catalogPolicy.retainedListingCap) {
    issues.push({ severity: "warning", reason: "catalog_full", retailer: null });
  }
  if (snapshot.skippedByCapacity !== null && snapshot.skippedByCapacity > 0) {
    issues.push({ severity: "error", reason: "capacity_skips", retailer: null });
  }

  return {
    observedAt: now.toISOString(),
    readOnly: true,
    status: issues.some((issue) => issue.severity === "error") ? "attention" : "healthy",
    retainedListings: snapshot.retainedListings,
    capacity: catalogPolicy.retainedListingCap,
    skippedByCapacity: snapshot.skippedByCapacity,
    retailers,
    issues,
  };
}
