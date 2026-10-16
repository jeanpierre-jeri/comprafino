import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { statementBudgetSql } from "./statement-budget.ts";

const env = { DATABASE_URL: "postgresql://test@fixture.neon.invalid/comprafino_test" };

function queryResponse(batch = false) {
  const result = {
    fields: [{ name: "value", dataTypeID: 23 }],
    rows: [["1"]],
    rowCount: 1,
    command: "SELECT",
  };
  return Response.json(batch ? { results: [result] } : result);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates fresh timeout signals for direct and batched HTTP requests without eager connections", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const mockFetch = vi.fn<typeof fetch>(async (_input, init) => {
    signals.push(init?.signal);
    const batch = typeof init?.body === "string" && init.body.includes('"queries"');
    return queryResponse(batch);
  });
  vi.stubGlobal("fetch", mockFetch);
  const db = createDatabase(env, { requestTimeoutMs: 1000 });
  expect(mockFetch).not.toHaveBeenCalled();
  await db.execute(sql`select 1 as value`);
  await db.batch([db.execute(sql`select 1 as value`)]);
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
  expect(signals[0]).not.toBe(signals[1]);
});

it("aborts a stalled request and allows a later query on the same client", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const mockFetch = vi.fn<typeof fetch>(async (_input, init) => {
    signals.push(init?.signal);
    return queryResponse();
  });
  mockFetch.mockImplementationOnce(async (_input, init) => {
    const signal = init?.signal;
    signals.push(signal);
    if (!signal) {
      throw new Error("Missing database deadline");
    }
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  vi.stubGlobal("fetch", mockFetch);
  const db = createDatabase(env, { requestTimeoutMs: 10 });
  await expect(db.execute(sql`select 1 as value`)).rejects.toMatchObject({
    cause: { sourceError: { name: "TimeoutError" } },
  });
  const result = await db.execute(sql`select 1 as value`);
  expect(result.rows).toEqual([{ value: 1 }]);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
  expect(signals[0]).not.toBe(signals[1]);
});

it("preserves the default transport and rejects invalid deadlines before connecting", async () => {
  const mockFetch = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.signal).toBeUndefined();
    return queryResponse();
  });
  vi.stubGlobal("fetch", mockFetch);
  for (const requestTimeoutMs of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    expect(() => createDatabase(env, { requestTimeoutMs })).toThrow(/timeout/u);
    expect(() => createDatabase(env, { statementTimeoutMs: requestTimeoutMs })).toThrow(/timeout/u);
  }
  expect(mockFetch).not.toHaveBeenCalled();
  await createDatabase(env).execute(sql`select 1 as value`);
  expect(mockFetch).toHaveBeenCalledOnce();
});

it("propagates request cancellation and never starts a later query on that request's client", async () => {
  const controller = new AbortController();
  const mockFetch = vi.fn<typeof fetch>(async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("Missing cancellation signal");
    controller.abort();
    signal.throwIfAborted();
    return queryResponse();
  });
  vi.stubGlobal("fetch", mockFetch);
  const db = createDatabase(env, { signal: controller.signal, requestTimeoutMs: 1000 });
  await expect(db.execute(sql`select 1`)).rejects.toThrow(/query/iu);
  await expect(db.execute(sql`select 2`)).rejects.toThrow(/query/iu);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValue(queryResponse());
  expect(
    (await createDatabase(env, { requestTimeoutMs: 1000 }).execute(sql`select 1`)).rows,
  ).toEqual([{ value: 1 }]);
});

it("applies SET LOCAL in the same single HTTP batch and preserves Drizzle direct/batch results", async () => {
  const payloads: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_input, init) => {
      if (typeof init?.body !== "string") throw new Error("Missing SQL body");
      const body: unknown = JSON.parse(init.body);
      payloads.push(body);
      const result: unknown = await queryResponse().json();
      return Response.json({ results: [result, result] });
    }),
  );
  const db = createDatabase(env, { statementTimeoutMs: 123, requestTimeoutMs: 1000 });
  expect(payloads).toHaveLength(0);
  expect((await db.execute(sql`select 1 as value`)).rows).toEqual([{ value: 1 }]);
  expect((await db.batch([db.execute(sql`select 1 as value`)]))[0].rows).toEqual([{ value: 1 }]);
  expect(payloads).toEqual(
    Array.from({ length: 2 }, () => ({
      queries: [
        { query: statementBudgetSql, params: ["123"] },
        { query: "select 1 as value", params: [] },
      ],
    })),
  );
});
