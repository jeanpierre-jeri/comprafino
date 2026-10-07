import { describe, expect, it } from "vitest";
import { recommendWeekday, weekdayEvidenceWindow } from "./weekday-recommendation.ts";
import { shiftObservationDay } from "./observation-coverage.ts";

const now = new Date("2026-10-07T18:00:00Z");
const start = "2026-09-07";
const days = (price: (index: number) => number | null) =>
  Array.from({ length: 28 }, (_, index) => ({
    date: shiftObservationDay(start, index),
    priceCents: price(index),
  }));

describe("conservative weekly evidence", () => {
  it("uses Lima and excludes the current partial week", () => {
    expect(weekdayEvidenceWindow(new Date("2026-10-05T04:59:00Z"))).toEqual({
      start: "2026-08-31",
      end: "2026-09-27",
    });
    expect(weekdayEvidenceWindow(new Date("2026-10-05T05:00:00Z"))).toEqual({
      start,
      end: "2026-10-04",
    });
  });
  it("withholds a recommendation with four covered dates or no coverage", () => {
    expect(recommendWeekday(days(() => 1000).slice(0, 4), now).status).toBe("insufficient");
    expect(recommendWeekday([], now).status).toBe("insufficient");
  });
  it("never fills a gap or an unsupported/mixed day", () => {
    expect(
      recommendWeekday(
        days(() => 1000).filter((_, index) => index !== 10),
        now,
      ).coveredDays,
    ).toBe(27);
    expect(
      recommendWeekday(
        days((index) => (index === 10 ? null : 1000)),
        now,
      ).status,
    ).toBe("insufficient");
  });
  it("constant prices and tied minima have no pattern", () => {
    expect(
      recommendWeekday(
        days(() => 1000),
        now,
      ).status,
    ).toBe("no_pattern");
    expect(
      recommendWeekday(
        days((index) => (index % 7 < 2 ? 1000 : 1500)),
        now,
      ).status,
    ).toBe("no_pattern");
  });
  it("requires the same unique materially lower day in all four weeks", () => {
    expect(
      recommendWeekday(
        days((index) => (index % 7 === 2 ? 1000 : 1500)),
        now,
      ),
    ).toMatchObject({ status: "recommended", weekday: 2, coveredDays: 28 });
    expect(
      recommendWeekday(
        days((index) => (index % 7 === Math.floor(index / 7) ? 1000 : 1500)),
        now,
      ).status,
    ).toBe("no_pattern");
    expect(
      recommendWeekday(
        days((index) => (index % 7 === 2 ? 1499 : 1500)),
        now,
      ).status,
    ).toBe("no_pattern");
    expect(
      recommendWeekday(
        days((index) => (index % 7 === 2 ? 9900 : 10000)),
        now,
      ).status,
    ).toBe("no_pattern");
  });
  it("rejects duplicates, nonpositive prices and ignores dates outside the fixed window", () => {
    const complete = days((index) => (index % 7 === 2 ? 1000 : 1500));
    expect(recommendWeekday([...complete, complete[0]!], now).status).toBe("insufficient");
    expect(
      recommendWeekday(
        days((index) => (index === 0 ? 0 : 1500)),
        now,
      ).status,
    ).toBe("insufficient");
    expect(
      recommendWeekday([...complete, { date: "2026-10-05", priceCents: 1 }], now).weekday,
    ).toBe(2);
  });
});
