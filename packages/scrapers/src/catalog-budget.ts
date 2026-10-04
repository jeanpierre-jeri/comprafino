import { refreshCoverage } from "./refresh-adapters.ts";

/** Estimate full, usable pages; unavailable rows can require more bounded pages. */
export function categoryRequestBudget() {
  const sources = Object.entries(refreshCoverage).flatMap(([retailer, categories]) =>
    Object.entries(categories).map(([category, limit]) => ({
      retailer,
      category,
      limit,
      typicalRequests: Math.ceil(limit / (retailer === "tottus" ? 48 : 20)),
      maximumRequests: retailer === "tottus" ? 12 : category === "dairy" ? 25 : 2,
    })),
  );
  return {
    sources,
    categorySources: sources.length,
    observationCap: sources.reduce((sum, source) => sum + source.limit, 0),
    typicalRequests: sources.reduce((sum, source) => sum + source.typicalRequests, 0),
    maximumRequests: sources.reduce((sum, source) => sum + source.maximumRequests, 0),
  };
}
/** Current workflows use one daily hour-list cron; refuse unsupported schedules. */
export function workflowCadence(yaml: string) {
  const schedules = [...yaml.matchAll(/cron:\s*"(\d+) ([\d,]+) \* \* \*"/gu)];
  if (schedules.length !== 1)
    throw new Error("Unsupported workflow cadence; review budget assumptions");
  const cron = schedules[0]![0].split('"')[1]!;
  const hours = schedules[0]![2]!.split(",").map(Number);
  if (
    Number(schedules[0]![1]) > 59 ||
    hours.some((hour) => hour > 23) ||
    new Set(hours).size !== hours.length
  )
    throw new Error("Invalid cadence");
  return { cron, runsPerDay: hours.length };
}
export function catalogProjection(listings: number, candidates: number, target: number) {
  if (
    !Number.isSafeInteger(listings) ||
    listings < 1 ||
    !Number.isSafeInteger(target) ||
    target < 1 ||
    !Number.isSafeInteger(candidates) ||
    candidates < 0
  )
    throw new Error("Invalid projection inputs");
  return {
    listings: target,
    matchingCandidateEstimate: Math.round(candidates * (target / listings) ** 2),
    derivationLinearFactor: target / listings,
    currentGuardExceeded: target > 1000,
    storageAtSameCompositionFactor: target / listings,
  };
}
