import { describe, expect, it } from "vitest";
import {
  defaultHistoryRange,
  historyWindow,
  intersectsHistoryRange,
  parseHistoryRange,
  summarizePriceHistory,
} from "./price-history.ts";
import type { OrdinaryPriceState } from "./price-history.ts";

const day = (n: number) => new Date(Date.UTC(2026, 8, n));

const state = (
  priceCents: number,
  from: number,
  until: number | null,
  previousPriceCents: number | null = null,
): OrdinaryPriceState => ({
  priceCents,
  validFrom: day(from),
  validUntil: until === null ? null : day(until),
  previousPriceCents,
  previousValidUntil: previousPriceCents === null ? null : day(from),
});

const summary = (states: OrdinaryPriceState[], start = day(10), end = day(20), seen = day(19)) =>
  summarizePriceHistory(states, start, end, seen);

describe("ordinary state history", () => {
  it("uses the audited 7-day default and rejects repeated/invalid URL values", () => {
    expect(defaultHistoryRange).toBe("7d");

    for (const raw of [undefined, "", "365d", "7", ["30d"], null]) {
      expect(parseHistoryRange(raw)).toBe("7d");
    }

    for (const range of ["7d", "30d", "90d"] as const) {
      expect(parseHistoryRange(range)).toBe(range);
      expect(historyWindow(range, day(20)).end).toEqual(day(20));
      expect(historyWindow(range, day(20)).start.getTime()).toBe(
        day(20).getTime() - Number.parseInt(range, 10) * 86_400_000,
      );
    }
  });
  it("intersects half-open closed states and carries in a state started before the range", () => {
    expect(intersectsHistoryRange(state(590, 1, 10), day(10), day(20), day(19))).toBe(false);
    expect(intersectsHistoryRange(state(590, 1, 11), day(10), day(20), day(19))).toBe(true);
    expect(intersectsHistoryRange(state(590, 21, null), day(10), day(20), day(22))).toBe(false);
    expect(summary([state(590, 1, 12), state(620, 12, null, 590)])).toMatchObject({
      minimumPriceCents: 590,
      maximumPriceCents: 620,
      differenceCents: 30,
      changeCount: 1,
    });
  });
  it("never extends an open state beyond its last successful observation", () => {
    expect(summary([state(590, 1, null)], day(10), day(20), day(9))).toMatchObject({
      status: "empty",
      currentPriceCents: null,
      points: [],
    });
    expect(summary([state(590, 1, null)], day(10), day(20), day(10)).currentPriceCents).toBe(590);
  });
  it("counts upward and downward ordinary transitions and selects the most recent", () => {
    const result = summary([state(590, 1, 12), state(620, 12, 15, 590), state(550, 15, null, 620)]);
    expect(result).toMatchObject({
      currentPriceCents: 550,
      minimumPriceCents: 550,
      maximumPriceCents: 620,
      differenceCents: -40,
      changeCount: 2,
      status: "events",
      lastChange: { fromCents: 620, toCents: 550, at: day(15) },
    });
    expect(summary([state(590, 1, 12), state(620, 12, null, 590)]).lastChange).toMatchObject({
      fromCents: 590,
      toCents: 620,
    });
  });
  it("uses a predecessor outside the range to describe a transition exactly at the start", () => {
    expect(summary([state(620, 10, null, 590)])).toMatchObject({
      changeCount: 1,
      lastChange: { fromCents: 590, toCents: 620 },
      minimumPriceCents: 620,
      differenceCents: 0,
    });
  });
  it("does not count reference-only changes or disconnected predecessors", () => {
    const disconnected = { ...state(620, 15, null, 590), previousValidUntil: day(12) };
    expect(summary([disconnected]).changeCount).toBe(0);
    expect(summary([state(590, 1, 12), state(590, 12, null, 590)])).toMatchObject({
      changeCount: 0,
      lastChange: null,
      status: "insufficient",
      minimumPriceCents: 590,
      maximumPriceCents: 590,
    });
  });
  it("provides an honest one-state result without treating verification as a change", () => {
    expect(summary([state(590, 11, null)])).toMatchObject({
      status: "insufficient",
      changeCount: 0,
      currentPriceCents: 590,
      lastChange: null,
    });
  });
  it("provides null metrics with no history", () => {
    expect(summary([])).toMatchObject({
      status: "empty",
      currentPriceCents: null,
      minimumPriceCents: null,
      maximumPriceCents: null,
      differenceCents: null,
      lastChange: null,
      changeCount: 0,
      points: [],
    });
  });
  it("records only actual starts/latest verification, without invented daily or clipped boundary points", () => {
    const result = summary([state(590, 1, 12), state(620, 12, null, 590)]);
    expect(result.points).toEqual([
      { at: day(12).getTime(), priceCents: 620, kind: "state-start" },
      { at: day(19).getTime(), priceCents: 620, kind: "latest-observation" },
    ]);
    expect(summary([state(590, 11, null)], day(10), day(20), day(11)).points).toHaveLength(1);
  });
  it("does not call a future verification current and leaves input order intact", () => {
    const input = [state(620, 12, null, 590), state(590, 1, 12)];
    expect(summary(input, day(10), day(20), day(21)).currentPriceCents).toBeNull();
    expect(input[0]?.priceCents).toBe(620);
  });
});
