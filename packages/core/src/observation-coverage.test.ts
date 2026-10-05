import { expect, it } from "vitest";
import { coveredPeriods, observationDay, rollupObservation } from "./observation-coverage.ts";
const at = (date: string) => new Date(date);
it("uses Peru day boundaries in both winter and summer, independent of UTC date", () => {
  for (const month of ["01", "07", "10"]) {
    expect(observationDay(at(`2026-${month}-04T04:59:59Z`))).toBe(`2026-${month}-03`);
    expect(observationDay(at(`2026-${month}-04T05:00:00Z`))).toBe(`2026-${month}-04`);
  }
});
it("rolls accepted observations into one day, retaining first time, and ignores replays", () => {
  const first = rollupObservation(undefined, at("2026-10-04T11:17:00Z"));
  const second = rollupObservation(first, at("2026-10-04T23:17:00Z"));
  expect(first.observationCount).toBe(1);
  expect(second).toEqual({
    ...first,
    observationCount: 2,
    lastObservedAt: at("2026-10-04T23:17:00Z"),
  });
  expect(rollupObservation(second, first.firstObservedAt)).toBe(second);
  expect(rollupObservation(second, second.lastObservedAt)).toBe(second);
  expect(rollupObservation(second, at("2026-10-05T05:00:00Z"))).toMatchObject({
    observationDate: "2026-10-05",
    observationCount: 1,
  });
});
it("groups consecutive local days and splits missing days, with no pre-coverage extension", () => {
  const input = [1, 2, 4, 5].map((n) =>
    rollupObservation(undefined, at(`2026-10-0${n}T11:00:00Z`)),
  );
  const periods = coveredPeriods(input, at("2026-09-30T11:00:00Z"), at("2026-10-06T11:00:00Z"));
  expect(periods).toEqual([
    { first: input[0]!.firstObservedAt, last: input[1]!.lastObservedAt, days: 2 },
    { first: input[2]!.firstObservedAt, last: input[3]!.lastObservedAt, days: 2 },
  ]);
  expect(input[0]!.observationDate).toBe("2026-10-01");
});
it("clips observation endpoints to the requested range", () => {
  const day = rollupObservation(
    rollupObservation(undefined, at("2026-10-04T11:00:00Z")),
    at("2026-10-04T23:00:00Z"),
  );
  expect(coveredPeriods([day], at("2026-10-04T12:00:00Z"), at("2026-10-04T22:00:00Z"))).toEqual([
    { first: at("2026-10-04T12:00:00Z"), last: at("2026-10-04T22:00:00Z"), days: 1 },
  ]);
});
