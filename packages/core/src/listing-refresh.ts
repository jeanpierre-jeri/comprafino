import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";

export const listingRefreshPolicy = {
  ageHours: 24,
  cooldownHours: 12,
  limit: 100,
  freshHours: 36,
  visibleHours: 72,
} as const;

export function offerFreshness(observedAt: Date, now: Date) {
  const age = (now.getTime() - observedAt.getTime()) / 3_600_000;

  // Future timestamps cannot safely establish a current observation.
  if (!Number.isFinite(age) || age < 0 || age > listingRefreshPolicy.visibleHours) {
    return "too-stale";
  }

  if (age <= listingRefreshPolicy.freshHours) {
    return "fresh";
  } else {
    return "stale";
  }
}

export const knownListingSchema = z.object({
  id: z.uuid(),
  retailer: retailerIdSchema,
  externalId: z.string().min(1),
  productId: z.string().min(1),
  url: z.url(),
  observedAt: z.coerce.date(),
  available: z.boolean().nullable().optional(),
  availabilityVerifiedAt: z.coerce.date().nullable().optional(),
  // Exact-association refresh priority hint; not public purchase eligibility.
  public: z.boolean(),
  shoppingRelevant: z.boolean().optional(),
  usefulStaple: z.boolean().optional(),
  firstSeenVia: z.enum(["unknown", "category", "discovery"]),
  lastCategoryObservedAt: z.coerce.date().nullable(),
  lastTargetedAttemptAt: z.coerce.date().nullable(),
});

export type KnownListing = z.infer<typeof knownListingSchema>;

export function hasTargetedRefreshPath(row: KnownListing): boolean {
  if (!/^\d+$/u.test(row.externalId) || !/^\d+$/u.test(row.productId)) return false;

  if (row.retailer !== "tottus") return true;

  return row.url.startsWith(`https://www.tottus.com.pe/tottus-pe/articulo/${row.productId}/`);
}

export function listingNeedsRefresh(row: KnownListing, now: Date): boolean {
  // Unknown category quotes cannot indefinitely prevent verification/recovery
  // after an explicit negative exact observation. Fresh negative evidence waits.
  const evidenceAt =
    row.available === false ? (row.availabilityVerifiedAt ?? row.observedAt) : row.observedAt;

  return (
    hasTargetedRefreshPath(row) &&
    evidenceAt.getTime() <= now.getTime() - listingRefreshPolicy.ageHours * 3_600_000 &&
    (!row.lastTargetedAttemptAt ||
      row.lastTargetedAttemptAt.getTime() <=
        now.getTime() - listingRefreshPolicy.cooldownHours * 3_600_000)
  );
}

export function selectListingRefresh(rows: readonly KnownListing[], now: Date, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > listingRefreshPolicy.limit) {
    throw new Error("Limit must be 1–100");
  }

  function priority(row: KnownListing): number {
    if (row.public) return 0;

    if (row.shoppingRelevant) return 1;

    if (row.firstSeenVia === "discovery") return 2;

    if (row.usefulStaple) return 3;

    return 4;
  }

  return rows
    .filter((row) => listingNeedsRefresh(row, now))
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        a.observedAt.getTime() - b.observedAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function parseListingRefreshOptions(args: readonly string[]) {
  let limit: number = listingRefreshPolicy.limit;
  let dryRun = false;
  let retailer: z.infer<typeof retailerIdSchema> | undefined;
  let externalId: string | undefined;
  const seen = new Set<string>();

  for (const arg of args.filter((value) => value !== "--")) {
    const key = arg.split("=")[0]!;

    if (seen.has(key)) {
      throw new Error("Duplicate option");
    }

    seen.add(key);

    if (arg === "--dry-run") {
      dryRun = true;
    } else if (/^--limit=\d+$/u.test(arg)) {
      limit = Number(arg.slice(8));
    } else if (arg.startsWith("--retailer=")) {
      retailer = retailerIdSchema.parse(arg.slice(11));
    } else if (/^--external-id=\d+$/u.test(arg)) {
      externalId = arg.slice(14);
    } else {
      throw new Error("Unknown listing refresh option");
    }
  }

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > listingRefreshPolicy.limit ||
    (externalId && !retailer)
  ) {
    throw new Error("Invalid listing refresh scope");
  }

  return { limit, dryRun, retailer, externalId };
}
