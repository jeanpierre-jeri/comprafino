import { z } from "zod";
import { observationDay, shiftObservationDay } from "./observation-coverage.ts";
import type { ShoppingEvaluation, ShoppingList } from "./shopping-list.ts";

export const shoppingHistoryRanges = [7, 30, 90] as const;

export const shoppingPriceHistorySchema = z.object({
  itemId: z.uuid(),
  listingId: z.uuid(),
  retailerName: z.string().min(1),
  periods: z
    .array(
      z.object({
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
        coveredDays: z.number().int().nonnegative().max(90),
        minimumCents: z.number().int().positive().safe().nullable(),
        observedAt: z.iso.datetime().nullable(),
        daysAgo: z.number().int().nonnegative().nullable(),
      }),
    )
    .length(3),
});

export type ShoppingPriceHistory = z.infer<typeof shoppingPriceHistorySchema>;
export type ShoppingHistoryDay = {
  listingId: string;
  date: string;
  priceCents: number;
  observedAt: Date;
};

/** Ordinary sale-package minima for the displayed product and store only.
 * Real observed dates establish coverage; elapsed state duration never does.
 * Sparse history describes observations, not a prediction of future prices. */
export function shoppingPriceHistories(
  list: ShoppingList,
  evaluations: readonly ShoppingEvaluation[],
  rows: readonly ShoppingHistoryDay[],
  now: Date,
): ShoppingPriceHistory[] {
  const today = observationDay(now);
  return list.items.flatMap((item) => {
    if (item.intent === "generic") return [];
    const evaluation = evaluations.find((result) => result.itemId === item.id);
    const option = item.intent === "preferred" ? evaluation?.preferred : evaluation?.best;
    if (!option || (item.listingId && option.id !== item.listingId)) return [];

    const days = rows.filter(
      (row) =>
        row.listingId === option.id &&
        row.observedAt <= now &&
        row.date === observationDay(row.observedAt) &&
        Number.isSafeInteger(row.priceCents) &&
        row.priceCents > 0,
    );
    return [
      shoppingPriceHistorySchema.parse({
        itemId: item.id,
        listingId: option.id,
        retailerName: option.retailerName,
        periods: shoppingHistoryRanges.map((range) => {
          const start = shiftObservationDay(today, 1 - range);
          const period = days.filter((day) => day.date >= start && day.date <= today);
          const minimum = [...period].sort(
            (a, b) =>
              a.priceCents - b.priceCents || b.observedAt.getTime() - a.observedAt.getTime(),
          )[0];
          return {
            days: range,
            coveredDays: new Set(period.map((day) => day.date)).size,
            minimumCents: minimum?.priceCents ?? null,
            observedAt: minimum?.observedAt.toISOString() ?? null,
            daysAgo: minimum
              ? Math.round((Date.parse(today) - Date.parse(minimum.date)) / 86_400_000)
              : null,
          };
        }),
      }),
    ];
  });
}
