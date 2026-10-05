import { coveredPeriods, observationDay, shiftObservationDay } from "./observation-coverage.ts";
import type { ObservationDay } from "./observation-coverage.ts";
export const historyRanges = ["7d", "30d", "90d"] as const;
export type HistoryRange = (typeof historyRanges)[number];
// Initial catalog audit: less than one day of history. Keep the default explicit.
export const defaultHistoryRange: HistoryRange = "7d";
export function parseHistoryRange(raw: unknown): HistoryRange {
  return historyRanges.find((range) => range === raw) ?? defaultHistoryRange;
}
export function historyWindow(range: HistoryRange, now = new Date()) {
  return { start: new Date(now.getTime() - Number.parseInt(range, 10) * 86_400_000), end: now };
}
export type OrdinaryPriceState = {
  priceCents: number;
  validFrom: Date;
  validUntil: Date | null;
  previousPriceCents: number | null;
  previousValidUntil: Date | null;
};
/** Stored intervals are half-open. Open states are bounded by actual last verification. */
export function intersectsHistoryRange(
  state: OrdinaryPriceState,
  start: Date,
  end: Date,
  lastObservedAt: Date,
): boolean {
  const until = state.validUntil ?? lastObservedAt;
  return state.validFrom <= end && until >= start && (state.validUntil === null || until > start);
}
export function summarizePriceHistory(
  input: readonly OrdinaryPriceState[],
  start: Date,
  end: Date,
  lastObservedAt: Date,
  coverage: readonly ObservationDay[] = [],
) {
  const states = input
    .filter((s) => intersectsHistoryRange(s, start, end, lastObservedAt))
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
  const changes = states.filter(
    (s) =>
      s.validFrom >= start &&
      s.validFrom <= end &&
      s.previousValidUntil?.getTime() === s.validFrom.getTime() &&
      s.previousPriceCents !== null &&
      s.previousPriceCents !== s.priceCents,
  );
  const current = states.find((s) => s.validUntil === null && lastObservedAt <= end);
  const last = changes.at(-1);
  const periods = coveredPeriods(coverage, start, end);
  // Each path is a state step sequence inside a covered run. Unsupported/missing
  // state intervals split paths too. Never extend beyond actual observation endpoints.
  const segments: { at: number; priceCents: number }[][] = [];
  for (const period of periods) {
    let path: { at: number; priceCents: number }[] = [];
    let previousUntil: number | undefined;
    for (const state of states) {
      const from = Math.max(period.first.getTime(), state.validFrom.getTime(), start.getTime());
      const until = Math.min(
        period.last.getTime(),
        (state.validUntil ?? lastObservedAt).getTime(),
        end.getTime(),
      );
      if (from > until || (from === until && state.validUntil !== null)) continue;
      if (previousUntil !== undefined && previousUntil !== from) {
        if (path.length > 1) segments.push(path);
        path = [];
      }
      path.push(
        { at: from, priceCents: state.priceCents },
        { at: until, priceCents: state.priceCents },
      );
      previousUntil = until;
    }
    if (path.length > 1 && path[0]!.at < path.at(-1)!.at) segments.push(path);
  }
  let unchangedDays = 0;
  // Anchored to today: yesterday's missing verification cannot imply continuity today.
  const today = observationDay(end);
  const dayMap = new Map(coverage.map((d) => [d.observationDate, d]));
  if (current && observationDay(lastObservedAt) === today) {
    for (let key = today; key >= observationDay(start); key = shiftObservationDay(key, -1)) {
      const day = dayMap.get(key);
      if (!day || day.firstObservedAt < start || day.lastObservedAt > end) break;
      const first = day.firstObservedAt.getTime();
      const streakEnd =
        unchangedDays === 0 ? day.lastObservedAt.getTime() : lastObservedAt.getTime();
      const spanning = states.filter(
        (s) =>
          s.validFrom.getTime() <= streakEnd &&
          (s.validUntil === null
            ? lastObservedAt.getTime() >= first
            : s.validUntil.getTime() > first),
      );
      if (
        !spanning.length ||
        spanning[0]!.validFrom.getTime() > first ||
        spanning.some((s) => s.priceCents !== current.priceCents) ||
        spanning.some(
          (s, i) => i > 0 && spanning[i - 1]!.validUntil?.getTime() !== s.validFrom.getTime(),
        ) ||
        changes.some((s) => observationDay(s.validFrom) === key)
      )
        break;
      unchangedDays++;
    }
  }
  return {
    states,
    coveragePeriods: periods,
    segments,
    verifiedUnchangedDays: unchangedDays >= 2 ? unchangedDays : null,
    currentPriceCents: current?.priceCents ?? null,
    minimumPriceCents: states.length ? Math.min(...states.map((s) => s.priceCents)) : null,
    maximumPriceCents: states.length ? Math.max(...states.map((s) => s.priceCents)) : null,
    differenceCents: current && states[0] ? current.priceCents - states[0].priceCents : null,
    changeCount: changes.length,
    lastChange:
      last && last.previousPriceCents !== null
        ? {
            fromCents: last.previousPriceCents,
            toCents: last.priceCents,
            at: last.validFrom,
            differenceCents: last.priceCents - last.previousPriceCents,
            absoluteDifferenceCents: Math.abs(last.priceCents - last.previousPriceCents),
            direction:
              last.priceCents < last.previousPriceCents ? ("down" as const) : ("up" as const),
            // Rounded integer percent from integer cents; zero baseline has no percent.
            percentDifference:
              last.previousPriceCents > 0
                ? Number(
                    (BigInt(last.priceCents - last.previousPriceCents) * 100n +
                      BigInt(last.priceCents >= last.previousPriceCents ? 1 : -1) *
                        BigInt(Math.floor(last.previousPriceCents / 2))) /
                      BigInt(last.previousPriceCents),
                  )
                : null,
          }
        : null,
    status:
      states.length === 0
        ? ("empty" as const)
        : changes.length === 0
          ? ("insufficient" as const)
          : ("events" as const),
    // Event markers remain actual known observation instants; coverage paths are separate.
    points: [
      ...states
        .filter((s) => s.validFrom >= start)
        .map((s) => ({
          at: s.validFrom.getTime(),
          priceCents: s.priceCents,
          kind: "state-start" as const,
        })),
      ...(current && lastObservedAt >= start && lastObservedAt > current.validFrom
        ? [
            {
              at: lastObservedAt.getTime(),
              priceCents: current.priceCents,
              kind: "latest-observation" as const,
            },
          ]
        : []),
    ].sort((a, b) => a.at - b.at),
  };
}
