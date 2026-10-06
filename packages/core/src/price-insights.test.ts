import { expect, it } from "vitest";
import { summarizePriceHistory } from "./price-history.ts";
import type { OrdinaryPriceState } from "./price-history.ts";
import { rollupObservation } from "./observation-coverage.ts";

const at = (day: number, hour = 11) => new Date(Date.UTC(2026, 9, day, hour));

const state = (
  price: number,
  from: number,
  until: number | null,
  previous: number | null = null,
): OrdinaryPriceState => ({
  priceCents: price,
  validFrom: at(from),
  validUntil: until === null ? null : at(until),
  previousPriceCents: previous,
  previousValidUntil: previous === null ? null : at(from),
});

const summarize = (states: OrdinaryPriceState[], days: number[]) =>
  summarizePriceHistory(
    states,
    at(1),
    at(8, 23),
    at(8),
    days.map((n) => rollupObservation(undefined, at(n))),
  );

it.each([
  [900, 750, -150, -17, "down"],
  [750, 900, 150, 20, "up"],
] as const)(
  "derives safe absolute and rounded percentage change from cents: %i to %i",
  (old, price, diff, percent, direction) => {
    const result = summarize(
      [state(old, 1, 5), state(price, 5, null, old)],
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    expect(result.lastChange).toMatchObject({
      fromCents: old,
      toCents: price,
      differenceCents: diff,
      absoluteDifferenceCents: 150,
      percentDifference: percent,
      direction,
      at: at(5),
    });
    expect(result.changeCount).toBe(1);
    expect(result.minimumPriceCents).toBe(750);
    expect(result.maximumPriceCents).toBe(900);
    expect(result.verifiedUnchangedDays).toBe(3); // Excludes price-change day.
  },
);

it("avoids percentage division for a zero baseline", () => {
  expect(
    summarize([state(900, 5, null, 0)], [5, 6, 7, 8]).lastChange?.percentDifference,
  ).toBeNull();
});

it("connects verified periods with exact steps while retaining same-day transitions", () => {
  const result = summarize([state(900, 1, 5), state(750, 5, null, 900)], [1, 2, 3, 4, 5, 6, 7, 8]);
  expect(result.segments).toEqual([
    [
      { at: at(1).getTime(), priceCents: 900 },
      { at: at(5).getTime(), priceCents: 900 },
      { at: at(5).getTime(), priceCents: 750 },
      { at: at(8).getTime(), priceCents: 750 },
    ],
  ]);
});

it("breaks chart continuity and unchanged streak at missing days", () => {
  const result = summarize([state(590, 1, null)], [1, 2, 3, 5, 7, 8]);
  expect(result.segments).toHaveLength(2);
  expect(result.verifiedUnchangedDays).toBe(2);
  expect(result.segments[0]!.at(-1)!.at).toBe(at(3).getTime());
  expect(result.segments[1]![0]!.at).toBe(at(7).getTime());
});

it("pre-coverage history stays disconnected and does not count toward the streak", () => {
  const result = summarize([state(590, 1, null)], [6, 7, 8]);
  expect(result.segments[0]![0]!.at).toBe(at(6).getTime());
  expect(result.points[0]!.at).toBe(at(1).getTime());
  expect(result.verifiedUnchangedDays).toBe(3);
});

it("ignores reference-only transitions in insights and unchanged continuity", () => {
  const result = summarize([state(590, 1, 5), state(590, 5, null, 590)], [1, 2, 3, 4, 5, 6, 7, 8]);
  expect(result.verifiedUnchangedDays).toBe(8);
  expect(result.changeCount).toBe(0);
  expect(result.lastChange).toBeNull();
});

it("does not claim a streak without today's coverage, two covered days, or usable states", () => {
  for (const days of [[], [8], [6, 7]]) {
    expect(summarize([state(590, 1, null)], days).verifiedUnchangedDays).toBeNull();
  }

  expect(summarize([], [7, 8]).verifiedUnchangedDays).toBeNull();
});

it("unsupported/missing state intervals split paths and stop streaks", () => {
  const result = summarize([state(590, 1, 5), state(590, 7, null)], [1, 2, 3, 4, 5, 6, 7, 8]);
  expect(result.segments).toHaveLength(2);
  expect(result.verifiedUnchangedDays).toBe(2);
});

it("the selected range bounds streaks and changes; no current conditional amounts enter", () => {
  const result = summarizePriceHistory(
    [state(590, 1, null)],
    at(6),
    at(8, 23),
    at(8),
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => rollupObservation(undefined, at(n))),
  );
  expect(result.verifiedUnchangedDays).toBe(3);
  expect(result.changeCount).toBe(0);
  expect(result.minimumPriceCents).toBe(590);
});

it("does not invent an old-price endpoint when coverage begins exactly at a transition", () => {
  const result = summarize([state(900, 1, 5), state(750, 5, null, 900)], [5, 6, 7, 8]);
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]!.every((p) => p.priceCents === 750)).toBe(true);
});
