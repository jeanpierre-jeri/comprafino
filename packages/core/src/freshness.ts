import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";

export const freshnessHours = { healthy: 18, delayed: 30 } as const;
export const safeIngestionError = "Ingestion failed; inspect CLI stage and source availability.";
export const operationalRunSchema = z.object({
  id: z.uuid(),
  retailerId: retailerIdSchema,
  startedAt: z.date(),
  endedAt: z.date().nullable(),
  status: z.enum(["running", "success", "failed"]),
  listingsFetched: z.number().int().nonnegative(),
  listingsPersisted: z.number().int().nonnegative(),
  listingsChanged: z.number().int().nonnegative(),
});
export type OperationalRun = z.infer<typeof operationalRunSchema>;
export function retailerFreshness(
  latestAttempt: OperationalRun | null,
  latestSuccess: OperationalRun | null,
  now: Date,
) {
  // The successful attempt's start is conservative: fetching precedes completion.
  const ageHours = latestSuccess
    ? Math.max(0, (now.getTime() - latestSuccess.startedAt.getTime()) / 3_600_000)
    : null;
  const freshness =
    ageHours === null
      ? "unknown"
      : ageHours <= freshnessHours.healthy
        ? "healthy"
        : ageHours <= freshnessHours.delayed
          ? "delayed"
          : "stale";
  return {
    latestAttempt,
    latestSuccess,
    ageHours,
    freshness,
    latestAttemptStatus: latestAttempt?.status ?? null,
    // Never trust historical arbitrary error text for display.
    latestFailure: latestAttempt?.status === "failed" ? safeIngestionError : null,
  };
}
