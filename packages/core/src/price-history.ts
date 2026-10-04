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
  return {
    states,
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
          }
        : null,
    status:
      states.length === 0
        ? ("empty" as const)
        : changes.length === 0
          ? ("insufficient" as const)
          : ("events" as const),
    // These are actual known observation instants. No daily points, boundary points or lines.
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
