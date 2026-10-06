"use client";

import { useQuery } from "@tanstack/react-query";
import type { PriceMode, ShoppingList } from "@comprafino/core";
import type { ShoppingSession } from "../../lib/shopping-list/session";
import { shoppingEvaluationQuery } from "../../lib/shopping-list/evaluation-query";

export function useShoppingEvaluation(
  list: ShoppingList,
  mode: PriceMode,
  ready: boolean,
  session: ShoppingSession,
) {
  const enabled = ready && list.items.length > 0;
  const query = useQuery(shoppingEvaluationQuery(list, mode, ready, session));

  // Do not show old quotes while refreshing or after a failure. A changed list/mode has its own key.
  const data = enabled && !query.isFetching && !query.isError ? query.data : undefined;
  return {
    evaluations: data?.evaluations ?? [],
    baskets: data?.baskets ?? [],
    pending: enabled && (query.isPending || query.isFetching),
    error: enabled && query.isError ? "No pudimos cargar los precios. Intenta nuevamente." : "",
    refresh: () => {
      void query.refetch();
    },
  };
}
