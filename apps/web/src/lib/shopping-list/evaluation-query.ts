import { queryOptions } from "@tanstack/react-query";
import { shoppingListEvaluationSchema } from "@comprafino/core";
import type { PriceMode, ShoppingList } from "@comprafino/core";
import type { ShoppingSession } from "./session";
import { shoppingSessionQueryKey } from "./query-client";
import { withinRequestBudget } from "../request-budget";
import { publicRequestPolicy } from "../public-request-policy";

export function shoppingEvaluationQuery(
  list: ShoppingList,
  mode: PriceMode,
  ready: boolean,
  session: ShoppingSession,
  request: typeof fetch = fetch,
  budgetMs: number = publicRequestPolicy.browserMs,
) {
  return queryOptions({
    queryKey: ["shopping-evaluation", ...shoppingSessionQueryKey(session), mode, list],
    enabled: ready && list.items.length > 0,
    queryFn: ({ signal }) =>
      withinRequestBudget(budgetMs, signal, async (requestSignal) => {
        const response = await request(`/api/list/evaluate?priceMode=${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(list),
          signal: requestSignal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("No pudimos cargar los precios.");
        }
        const body: unknown = await response.json();
        return shoppingListEvaluationSchema.parse(body);
      }),
    retry: false,
    gcTime: 0,
    refetchInterval: publicRequestPolicy.evaluationRefreshMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
}
