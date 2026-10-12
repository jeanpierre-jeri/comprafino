import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client.ts";

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
  }
  expect(mockFetch).not.toHaveBeenCalled();
  await createDatabase(env).execute(sql`select 1 as value`);
  expect(mockFetch).toHaveBeenCalledOnce();
});
