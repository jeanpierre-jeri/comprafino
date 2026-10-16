import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@comprafino/db";
import { optimizeBasket } from "@comprafino/core";
import { withinRequestBudget } from "../src/lib/request-budget.ts";
import { boundedJson } from "../src/server/request-body.ts";
import { shoppingListPost } from "../src/server/shopping-list-handler.ts";
import { shoppingListSyncHandlers } from "../src/server/shopping-list-sync-handler.ts";

const origin = "http://localhost";
const database = () => createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });
const empty = () => ({ revision: 0, list: { version: 2 as const, items: [] } });
const evaluation = () => ({
  evaluations: [],
  weekdayRecommendations: [],
  baskets: optimizeBasket([]),
  evaluatedAt: new Date().toISOString(),
  timings: { queryMs: 0, totalMs: 0 },
});
const evaluateRequest = (signal?: AbortSignal) =>
  new Request(`${origin}/api/list/evaluate`, {
    method: "POST",
    body: JSON.stringify(empty().list),
    signal,
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}
const syncOptions = {
  session: async () => ({ user: { id: randomUUID() } }),
  origin: () => origin,
  database,
  budgetMs: 25,
};
const syncRequest = () =>
  new Request(`${origin}/api/list/sync`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: 0, operation: { type: "remove", id: randomUUID() } }),
  });

test("a dependency ignoring abort cannot keep the caller waiting or install a late result", async () => {
  const pending = deferred<number>();
  let signal: AbortSignal | undefined;
  await expect(
    withinRequestBudget(20, undefined, async (active) => {
      signal = active;
      return pending.promise;
    }),
  ).rejects.toMatchObject({ name: "TimeoutError" });
  expect(signal?.aborted).toBe(true);
  pending.resolve(1);
  expect(await withinRequestBudget(100, undefined, async () => 2)).toBe(2);
});

test("already canceled requests perform no dependency work and in-flight aborts propagate", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await expect(
    withinRequestBudget(100, controller.signal, async () => {
      called = true;
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(called).toBe(false);
  const running = new AbortController();
  await expect(
    withinRequestBudget(100, running.signal, async (signal) => {
      running.abort();
      signal.throwIfAborted();
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("synchronous work that overruns the budget cannot return a successful late value", async () => {
  await expect(
    withinRequestBudget(2, undefined, async () => {
      const end = performance.now() + 8;
      while (performance.now() < end) {
        /* Deliberate bounded CPU fixture. */
      }
      return 1;
    }),
  ).rejects.toMatchObject({ name: "TimeoutError" });
});

test("slow chunked input cancels the reader and returns 408 before database work", async () => {
  let canceled = false;
  const request = new Request(origin, {
    method: "POST",
    body: new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    ...{ duplex: "half" },
  });
  expect(await boundedJson(request, request.signal, 20)).toEqual({ status: 408 });
  expect(canceled).toBe(true);
  expect(await boundedJson(evaluateRequest())).toEqual({ body: empty().list });
});

test("evaluation deadline propagates to DB, returns safe uncached 503 and later requests recover", async () => {
  let signal: AbortSignal | undefined;
  const pending = deferred<ReturnType<typeof evaluation>>();
  let slow = true;
  const POST = shoppingListPost(
    (_env, options) => {
      signal = options?.signal;
      return database();
    },
    async () => (slow ? pending.promise : evaluation()),
    25,
  );
  const failure = await POST(evaluateRequest());
  expect(failure.status).toBe(503);
  expect(failure.headers.get("cache-control")).toBe("no-store");
  expect(await failure.json()).toEqual({
    error: "No pudimos cargar los precios. Intenta nuevamente.",
  });
  expect(signal?.aborted).toBe(true);
  pending.resolve(evaluation());
  slow = false;
  expect((await POST(evaluateRequest())).status).toBe(200);
});

test("HTTP request abort cancels evaluation without poisoning the next request", async () => {
  const parent = new AbortController();
  const POST = shoppingListPost(
    database,
    async () => {
      parent.abort();
      return evaluation();
    },
    100,
  );
  expect((await POST(evaluateRequest(parent.signal))).status).toBe(503);
  expect(
    (await shoppingListPost(database, async () => evaluation())(evaluateRequest())).status,
  ).toBe(200);
});

test("late authentication cannot start a list read or mutation after its request expires", async () => {
  for (const method of ["GET", "POST"] as const) {
    const pending = deferred<{ user: { id: string } }>();
    let called = false;
    const handlers = shoppingListSyncHandlers({
      ...syncOptions,
      session: () => pending.promise,
      database: () => {
        called = true;
        return database();
      },
    });
    const response = await handlers[method](syncRequest());
    expect(await response.json()).toEqual({ error: "list_unavailable" });
    pending.resolve({ user: { id: randomUUID() } });
    await Promise.resolve();
    expect(called).toBe(false);
  }
});

test("read timeout and mutation uncertainty are distinct; confirmed writes are recovered by GET", async () => {
  const pendingRead = deferred<ReturnType<typeof empty>>();
  const pendingWrite = deferred<{ status: "success"; state: ReturnType<typeof empty> }>();
  const saved = empty();
  const handlers = shoppingListSyncHandlers({
    ...syncOptions,
    read: () => pendingRead.promise,
    mutate: () => pendingWrite.promise,
  });
  expect(await (await handlers.GET(new Request(origin))).json()).toEqual({
    error: "list_unavailable",
  });
  expect(await (await handlers.POST(syncRequest())).json()).toEqual({
    error: "mutation_uncertain",
  });
  saved.revision = 1;
  pendingWrite.resolve({ status: "success", state: saved });
  pendingRead.resolve(saved);
  const recovered = shoppingListSyncHandlers({ ...syncOptions, read: async () => saved });
  expect(await (await recovered.GET(new Request(origin))).json()).toEqual(saved);
});
