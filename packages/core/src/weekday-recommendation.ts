import type { ShoppingList, ShoppingCandidate } from "./shopping-list.ts";
import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";
import { observationDay, shiftObservationDay } from "./observation-coverage.ts";

export const weekdayLabels = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

export const weekdayPatternSchema = z
  .object({
    status: z.enum(["insufficient", "no_pattern", "recommended"]),
    weekday: z.number().int().min(0).max(6).nullable(),
    coveredDays: z.number().int().min(0).max(28),
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.status === "recommended") !== (value.weekday !== null) ||
      (value.status !== "insufficient" && value.coveredDays !== 28)
    ) {
      ctx.addIssue({ code: "custom", message: "Inconsistent weekday evidence" });
    }
  });

export type WeekdayPattern = z.infer<typeof weekdayPatternSchema>;

export const shoppingWeekdaySchema = z.object({
  itemId: z.uuid(),
  series: z
    .array(
      z.object({
        listingId: z.uuid(),
        retailerName: z.string().min(1),
        pattern: weekdayPatternSchema,
      }),
    )
    .max(retailerIdSchema.options.length),
});

export type ShoppingWeekday = z.infer<typeof shoppingWeekdaySchema>;

/** Last four completed Monday–Sunday weeks; the current partial week is excluded. */
export function weekdayEvidenceWindow(now: Date) {
  const today = observationDay(now);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const end = shiftObservationDay(today, -weekday - 1);

  return { start: shiftObservationDay(end, -27), end };
}

/** A daily value must come from real coverage and a supported, unchanged ordinary
 * price across its first/last observations. Null days and gaps stay unknown. */
export function recommendWeekday(
  days: readonly { date: string; priceCents: number | null }[],
  now: Date,
): WeekdayPattern {
  const { start, end } = weekdayEvidenceWindow(now);
  const values = new Map<string, number>();
  const seen = new Set<string>();

  for (const day of days) {
    if (day.date < start || day.date > end) continue;

    if (seen.has(day.date)) {
      values.delete(day.date);
      continue;
    }

    seen.add(day.date);

    if (day.priceCents !== null && Number.isSafeInteger(day.priceCents) && day.priceCents > 0) {
      values.set(day.date, day.priceCents);
    }
  }

  const base = { start, end, coveredDays: values.size, weekday: null };
  if (values.size !== 28) return { ...base, status: "insufficient" };

  let repeated: number | undefined;
  for (let week = 0; week < 4; week++) {
    const prices = Array.from({ length: 7 }, (_, index) =>
      values.get(shiftObservationDay(start, week * 7 + index))!,
    );
    const minimum = Math.min(...prices);
    const winner = prices.indexOf(minimum);
    const clear = prices.every(
      (price, index) =>
        index === winner || price - minimum >= Math.max(100, Math.ceil(price * 0.05)),
    );

    if (!clear || (repeated !== undefined && repeated !== winner)) {
      return { ...base, status: "no_pattern" };
    }

    repeated = winner;
  }

  return { ...base, status: "recommended", weekday: repeated ?? null };
}

export function shoppingWeekdays(
  list: ShoppingList,
  candidates: readonly ShoppingCandidate[],
  rows: readonly { listingId: string; date: string; priceCents: number | null }[],
  now: Date,
): ShoppingWeekday[] {
  return list.items.map((item) =>
    shoppingWeekdaySchema.parse({
      itemId: item.id,
      series:
        item.intent === "generic"
          ? []
          : candidates
              .filter(
                (candidate) =>
                  candidate.canonicalId === item.canonicalId &&
                  candidate.pricingBasis !== "kg" &&
                  candidate.available !== false,
              )
              .map((candidate) => ({
                listingId: candidate.id,
                retailerName: candidate.retailerName,
                pattern: recommendWeekday(
                  rows.filter((row) => row.listingId === candidate.id),
                  now,
                ),
              })),
    }),
  );
}
