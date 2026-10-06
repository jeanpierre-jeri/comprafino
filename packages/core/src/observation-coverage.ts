/** Calendar keys always use the IANA Peru timezone, independent of host timezone. */
export const observationTimeZone = "America/Lima";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: observationTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function observationDay(at: Date): string {
  return dayFormatter.format(at);
}

/** Calendar arithmetic on date keys, not local-midnight offsets or DST assumptions. */
export function shiftObservationDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);

  return date.toISOString().slice(0, 10);
}

export type ObservationDay = {
  observationDate: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
};

/** Reference contract: equal/older replays are not new accepted observations. */
export function rollupObservation(previous: ObservationDay | undefined, at: Date): ObservationDay {
  const day = observationDay(at);

  if (!previous || previous.observationDate !== day) {
    return { observationDate: day, firstObservedAt: at, lastObservedAt: at, observationCount: 1 };
  }

  if (at <= previous.lastObservedAt) return previous;

  return { ...previous, lastObservedAt: at, observationCount: previous.observationCount + 1 };
}

export function coveredPeriods(input: readonly ObservationDay[], start: Date, end: Date) {
  const days = input
    .filter((d) => d.lastObservedAt >= start && d.firstObservedAt <= end)
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
  const periods: { first: Date; last: Date; days: number }[] = [];
  let previous: string | undefined;

  for (const day of days) {
    const current = periods.at(-1);
    const first = new Date(Math.max(start.getTime(), day.firstObservedAt.getTime()));
    const last = new Date(Math.min(end.getTime(), day.lastObservedAt.getTime()));

    if (current && previous && shiftObservationDay(previous, 1) === day.observationDate) {
      current.last = last;
      current.days++;
    } else {
      periods.push({ first, last, days: 1 });
    }

    previous = day.observationDate;
  }

  return periods;
}
