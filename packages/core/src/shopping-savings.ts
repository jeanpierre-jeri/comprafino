import { shoppingListPolicy } from "./shopping-list.ts";
import type { ShoppingEvaluation, ShoppingListItem, ShoppingOption } from "./shopping-list.ts";

export type ShoppingSavingsNotice = {
  kind: "preferred-alternative" | "same-product" | "compatible-option";
  itemId: string;
  option: ShoppingOption;
  baseline: ShoppingOption;
  savingsCents: number;
};

/** Disclosure of already evaluated current options; never authorizes a new substitution. */
export function shoppingSavingsNotice(
  item: ShoppingListItem,
  evaluation: ShoppingEvaluation,
): ShoppingSavingsNotice | null {
  if (evaluation.itemId !== item.id) return null;

  let option = evaluation.best;
  let baseline: ShoppingOption | undefined;
  let kind: ShoppingSavingsNotice["kind"];

  if (item.intent === "preferred" && evaluation.preferred && evaluation.alternative) {
    option = evaluation.alternative;
    baseline = evaluation.preferred;
    kind = "preferred-alternative";
  } else {
    if (!option) return null;

    const best = option;

    if (item.intent !== "generic") {
      if (option.canonicalId !== item.canonicalId) return null;

      baseline = evaluation.options.find(
        (candidate) =>
          candidate.id !== best.id &&
          candidate.canonicalId === item.canonicalId &&
          candidate.retailerName !== best.retailerName,
      );
      kind = "same-product";
    } else {
      // The immediate next evaluated option is the baseline. A tied cheapest
      // option suppresses a savings claim; never skip it to inflate the amount.
      baseline = evaluation.options.find((candidate) => candidate.id !== best.id);
      kind =
        option.canonicalId &&
        option.canonicalId === baseline?.canonicalId &&
        option.retailerName !== baseline?.retailerName
          ? "same-product"
          : "compatible-option";
    }
  }

  if (
    !option ||
    !baseline ||
    option.available === false ||
    baseline.available === false ||
    option.totalCostCents <= 0 ||
    baseline.totalCostCents <= 0
  ) {
    return null;
  }

  const savingsCents = baseline.totalCostCents - option.totalCostCents;
  // Apply the existing meaningful-savings gate to notifications, without
  // changing which offers the evaluator returns or how baskets are optimized.
  const minimumSavings = Math.max(
    shoppingListPolicy.preferredSavingsCents,
    Math.ceil(baseline.totalCostCents * shoppingListPolicy.preferredSavingsFraction),
  );
  if (savingsCents < minimumSavings) return null;

  if (kind === "preferred-alternative" && savingsCents !== evaluation.savingsCents) return null;

  return { kind, itemId: item.id, option, baseline, savingsCents };
}
