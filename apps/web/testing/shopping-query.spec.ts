import { test, expect } from "@playwright/test";
import { QueryObserver } from "@tanstack/react-query";
import {
  evaluateShoppingFulfillment,
  optimizeBasket,
  shoppingListItemSchema,
} from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";
import { createShoppingQueryClient } from "../src/lib/shopping-list/query-client.ts";
import { shoppingEvaluationQuery } from "../src/lib/shopping-list/evaluation-query.ts";

function list(number: number): ShoppingList {
  return {
    version: 2,
    items: [
      shoppingListItemSchema.parse({
        id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
        intent: "generic",
        canonicalId: null,
        label: `Necesidad ${number}`,
        query: `necesidad ${number}`,
        quantity: { amount: 1, unit: "unit" },
        frequency: "weekly",
        createdAt: "2026-10-06T00:00:00.000Z",
        updatedAt: "2026-10-06T00:00:00.000Z",
      }),
    ],
  };
}

function evaluation(input: ShoppingList) {
  const results = input.items.map((item) => evaluateShoppingFulfillment(item, [], "standard"));
  return {
    evaluations: results.map((result) => result.evaluation),
    baskets: optimizeBasket(input.items.map((item) => ({ itemId: item.id, options: [] }))),
    evaluatedAt: "2026-10-06T00:00:00.000Z",
    timings: { queryMs: 0, totalMs: 0 },
  };
}

test("evaluation uses the public POST boundary and validates the returned document", async () => {
  const client = createShoppingQueryClient();
  const input = list(1);
  let requestUrl = "";
  let requestOptions: RequestInit | undefined;
  const options = shoppingEvaluationQuery(
    input,
    "benefits",
    true,
    { status: "anonymous" },
    async (url, init) => {
      requestUrl = typeof url === "string" ? url : "";
      requestOptions = init;
      return Response.json(evaluation(input));
    },
  );
  try {
    expect(await client.fetchQuery(options)).toEqual(evaluation(input));
    expect(requestUrl).toBe("/api/list/evaluate?priceMode=benefits");
    expect(requestOptions).toMatchObject({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify(input),
    });
  } finally {
    client.clear();
  }
});

test("changing list/account cancels old evaluation and cannot install a late result", async () => {
  const client = createShoppingQueryClient();
  const firstList = list(1);
  let release: ((response: Response) => void) | undefined;
  let firstSignal: AbortSignal | null | undefined;
  const first = shoppingEvaluationQuery(
    firstList,
    "standard",
    true,
    { status: "authenticated", userId: "A", sessionId: "s1" },
    async (_url, init) => {
      firstSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
  );
  const nextList = list(2);
  const next = shoppingEvaluationQuery(
    nextList,
    "benefits",
    true,
    { status: "authenticated", userId: "B", sessionId: "s2" },
    async () => Response.json(evaluation(nextList)),
  );
  const observer = new QueryObserver(client, first);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await expect.poll(() => Boolean(release)).toBe(true);
    observer.setOptions(next);
    expect(firstSignal?.aborted).toBe(true);
    release?.(Response.json(evaluation(firstList)));
    await expect.poll(() => observer.getCurrentResult().isSuccess).toBe(true);
    expect(observer.getCurrentResult().data).toEqual(evaluation(nextList));
    expect(client.getQueryData(first.queryKey)).toBeUndefined();
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("evaluation corruption and HTTP failure do not cache empty success or retry automatically", async () => {
  for (const status of [200, 503]) {
    const client = createShoppingQueryClient();
    let requests = 0;
    const options = shoppingEvaluationQuery(
      list(1),
      "standard",
      true,
      { status: "anonymous" },
      async () => {
        requests++;
        return Response.json({ evaluations: [], baskets: [] }, { status });
      },
    );
    try {
      await expect(client.fetchQuery(options)).rejects.toThrow();
      expect(requests).toBe(1);
      expect(client.getQueryData(options.queryKey)).toBeUndefined();
      expect(client.getQueryState(options.queryKey)?.status).toBe("error");
    } finally {
      client.clear();
    }
  }
});
