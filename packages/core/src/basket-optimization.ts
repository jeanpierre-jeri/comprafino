import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";
import {
  compareShoppingOptions,
  shoppingEvaluationSchema,
  shoppingOptionSchema,
} from "./shopping-list.ts";

export const basketOptionSchema = shoppingOptionSchema.extend({ retailerId: retailerIdSchema });
export type BasketOption = z.infer<typeof basketOptionSchema>;
const assignmentSchema = z.object({ itemId: z.uuid(), option: basketOptionSchema });
const money = z.number().int().nonnegative().safe();
const common = {
  maxRetailers: z.number().int().min(1).max(3),
  retailerIds: z.array(retailerIdSchema).max(3),
  assignments: z.array(assignmentSchema).max(50),
  missingItemIds: z.array(z.uuid()).max(50),
  ordinarySubtotalCents: money,
  marginalSavingsCents: money.nullable(),
};
export const basketPlanSchema = z
  .discriminatedUnion("status", [
    z.object({
      ...common,
      status: z.literal("empty"),
      marginalSavingsCents: z.null(),
      totalCostCents: z.null(),
      partialSubtotalCents: z.null(),
    }),
    z.object({
      ...common,
      status: z.literal("complete"),
      totalCostCents: money,
      partialSubtotalCents: z.null(),
    }),
    z.object({
      ...common,
      status: z.literal("incomplete"),
      marginalSavingsCents: z.null(),
      totalCostCents: z.null(),
      partialSubtotalCents: money,
    }),
  ])
  .superRefine((plan, ctx) => {
    const ids = plan.assignments.map((a) => a.itemId);
    const retailers = [...new Set(plan.assignments.map((a) => a.option.retailerId))].sort();
    const cost = plan.assignments.reduce((sum, a) => sum + a.option.totalCostCents, 0);
    const ordinary = plan.assignments.reduce((sum, a) => sum + a.option.ordinaryTotalCents, 0);
    if (
      new Set([...ids, ...plan.missingItemIds]).size !== ids.length + plan.missingItemIds.length ||
      ids.length + plan.missingItemIds.length > 50 ||
      retailers.length > plan.maxRetailers ||
      retailers.join(",") !== plan.retailerIds.join(",") ||
      ordinary !== plan.ordinarySubtotalCents ||
      (plan.status === "complete" &&
        (!ids.length || plan.missingItemIds.length || cost !== plan.totalCostCents)) ||
      (plan.status === "incomplete" &&
        (!plan.missingItemIds.length || cost !== plan.partialSubtotalCents)) ||
      (plan.status === "empty" && (ids.length || plan.missingItemIds.length))
    )
      ctx.addIssue({ code: "custom", message: "Inconsistent basket coverage or totals" });
  });
export type BasketPlan = z.infer<typeof basketPlanSchema>;
export const shoppingListEvaluationSchema = z
  .object({
    evaluations: z.array(shoppingEvaluationSchema).max(50),
    baskets: z.tuple([basketPlanSchema, basketPlanSchema, basketPlanSchema]),
    evaluatedAt: z.iso.datetime(),
    timings: z.object({ queryMs: z.number().nonnegative(), totalMs: z.number().nonnegative() }),
  })
  .superRefine((result, ctx) => {
    const ids = result.evaluations.map((e) => e.itemId).sort();
    for (const [index, plan] of result.baskets.entries()) {
      const covered = [...plan.assignments.map((a) => a.itemId), ...plan.missingItemIds].sort();
      const previous = result.baskets[index - 1];
      const savings =
        previous?.status === "complete" && plan.status === "complete"
          ? previous.totalCostCents - plan.totalCostCents
          : null;
      if (
        plan.maxRetailers !== index + 1 ||
        covered.join(",") !== ids.join(",") ||
        plan.marginalSavingsCents !== savings ||
        new Set(ids).size !== ids.length
      )
        ctx.addIssue({ code: "custom", message: "Inconsistent shopping evaluation tiers" });
    }
  });
export type ShoppingListEvaluation = z.infer<typeof shoppingListEvaluationSchema>;

export function compareBasketPlans(a: BasketPlan, b: BasketPlan) {
  const cost = (p: BasketPlan) => p.totalCostCents ?? p.partialSubtotalCents ?? 0;
  const base =
    b.assignments.length - a.assignments.length ||
    cost(a) - cost(b) ||
    a.retailerIds.length - b.retailerIds.length ||
    a.retailerIds.join(",").localeCompare(b.retailerIds.join(","));
  if (base) return base;
  for (let i = 0; i < a.assignments.length; i++) {
    const left = a.assignments[i]!;
    const right = b.assignments[i]!;
    const compared =
      left.itemId.localeCompare(right.itemId) || compareShoppingOptions(left.option, right.option);
    if (compared) return compared;
  }
  return a.missingItemIds.join(",").localeCompare(b.missingItemIds.join(","));
}

/** Only already-approved fulfillments enter this optimizer. Each need is bought
 * from one listing in whole packages; prices have no cross-item interactions. */
export function optimizeBasket(
  needs: readonly { itemId: string; options: readonly BasketOption[] }[],
): [BasketPlan, BasketPlan, BasketPlan] {
  if (needs.length > 50 || new Set(needs.map((n) => n.itemId)).size !== needs.length)
    throw new Error("Invalid basket needs");
  const ordered = [...needs].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const retailers = retailerIdSchema.options.slice().sort();
  const results: BasketPlan[] = [];
  for (let mask = 1; mask < 1 << retailers.length; mask++) {
    const subset = retailers.filter((_, i) => mask & (1 << i));
    const assignments: BasketPlan["assignments"] = [];
    const missingItemIds: string[] = [];
    for (const need of ordered) {
      const best = need.options
        .filter(
          (o) =>
            Number.isSafeInteger(o.ordinaryTotalCents) &&
            o.ordinaryTotalCents > 0 &&
            subset.includes(o.retailerId),
        )
        .sort(compareShoppingOptions)[0];
      if (best) assignments.push({ itemId: need.itemId, option: best });
      else missingItemIds.push(need.itemId);
    }
    const total = assignments.reduce((sum, a) => sum + a.option.totalCostCents, 0);
    const ordinary = assignments.reduce((sum, a) => sum + a.option.ordinaryTotalCents, 0);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(ordinary))
      throw new Error("Basket total overflow");
    const status = !needs.length ? "empty" : missingItemIds.length ? "incomplete" : "complete";
    results.push(
      basketPlanSchema.parse({
        status,
        maxRetailers: subset.length,
        retailerIds: [...new Set(assignments.map((a) => a.option.retailerId))].sort(),
        assignments,
        missingItemIds,
        ordinarySubtotalCents: ordinary,
        marginalSavingsCents: null,
        totalCostCents: status === "complete" ? total : null,
        partialSubtotalCents: status === "incomplete" ? total : null,
      }),
    );
  }
  const tiers = [1, 2, 3].map((limit) => ({
    ...results.filter((p) => p.retailerIds.length <= limit).sort(compareBasketPlans)[0]!,
    maxRetailers: limit,
  }));
  for (let i = 1; i < tiers.length; i++) {
    const previous = tiers[i - 1]!;
    const current = tiers[i]!;
    if (previous.status === "complete" && current.status === "complete")
      current.marginalSavingsCents = previous.totalCostCents - current.totalCostCents;
  }
  return [tiers[0]!, tiers[1]!, tiers[2]!];
}

/** Presentation default: first complete limit, otherwise best coverage/cost. */
export function defaultBasketLimit(plans: readonly BasketPlan[]): number {
  return (
    plans.find((p) => p.status === "complete")?.maxRetailers ??
    [...plans].sort(compareBasketPlans)[0]?.maxRetailers ??
    1
  );
}
