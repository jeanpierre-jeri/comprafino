import { test, expect } from "@playwright/test";
import { shoppingListPost } from "../src/server/shopping-list-handler.ts";
import { shoppingListBodyBytes } from "../src/server/request-body.ts";
import { createDatabase } from "@comprafino/db";
import { randomUUID } from "node:crypto";
import { optimizeBasket } from "@comprafino/core";

test.beforeEach(() => {
  calls = 0;
});

let calls = 0;

let invalid = false;

const database = () => {
  calls++;

  return createDatabase({ DATABASE_URL: "postgresql://unused@localhost/comprafino_test" });
};

function request(body: string, mode = "standard") {
  return new Request(`http://localhost/api/list/evaluate?priceMode=${mode}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

test("validates external list bodies before accessing the catalog", async () => {
  const POST = shoppingListPost(database);

  for (const body of ["{", "null", '{"version":3,"items":[]}', '{"version":2,"items":[{}]}']) {
    expect((await POST(request(body))).status).toBe(400);
  }

  expect(calls).toBe(0);
});

test("valid normal and maximum payloads use the HTTP handler and preserve mode/timings", async () => {
  const item = () => ({
    id: randomUUID(),
    intent: "strict",
    label: "á".repeat(120),
    query: "á".repeat(120),
    canonicalId: randomUUID(),
    substitutionProfile: "á".repeat(80),
    quantityMode: "normalized",
    quantity: { amount: 1, unit: "unit" },
    frequency: "weekly",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  for (const items of [
    [],
    [
      {
        ...item(),
        intent: "generic",
        canonicalId: null,
        label: "Huevos",
        query: "huevos",
        substitutionProfile: null,
      },
    ],
    Array.from({ length: 50 }, item),
  ]) {
    const body = JSON.stringify({ version: 2, items }).replaceAll("á", "\\u00e1");
    expect(new TextEncoder().encode(body).length).toBeLessThan(shoppingListBodyBytes);
    let mode: unknown;
    const POST = shoppingListPost(database, async (_db, list, selectedMode) => {
      mode = selectedMode;
      expect(list.items).toHaveLength(items.length);

      return {
        evaluations: [],
        baskets: optimizeBasket([]),
        evaluatedAt: new Date().toISOString(),
        timings: { queryMs: 12, totalMs: 15 },
      };
    });
    const response = await POST(request(body, "unexpected"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Server-Timing")).toContain("db;dur=12.00");
    expect(mode).toBe("standard");
  }
});

test("bounds actual UTF-8 bytes, declared length, logical items and huge fields before DB work", async () => {
  let evaluations = 0;
  const POST = shoppingListPost(database, async () => {
    evaluations++;

    throw new Error("Rejected body reached evaluation");
  });

  for (const body of [
    " ".repeat(shoppingListBodyBytes + 1),
    '"' + "🥚".repeat(shoppingListBodyBytes / 4) + '"',
  ]) {
    expect((await POST(request(body))).status).toBe(413);
  }

  const understated = request(" ".repeat(shoppingListBodyBytes + 1));
  understated.headers.set("content-length", "1");
  expect((await POST(understated)).status).toBe(413);
  const oversized = request('{"version":2,"items":[]}');
  oversized.headers.set("content-length", String(shoppingListBodyBytes + 1));
  expect((await POST(oversized)).status).toBe(413);
  const item = {
    id: randomUUID(),
    intent: "generic",
    label: "Huevos",
    query: "huevos",
    canonicalId: null,
    quantity: { amount: 1, unit: "unit" },
    frequency: "weekly",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (const items of [
    Array.from({ length: 51 }, () => ({ ...item, id: randomUUID() })),
    [{ ...item, label: "x".repeat(121) }],
    [{ ...item, query: "x".repeat(121) }],
    [{ ...item, query: "x".repeat(100_000) }],
    [{ ...item, label: "x".repeat(100_000) }],
  ]) {
    expect((await POST(request(JSON.stringify({ version: 2, items })))).status).toBe(400);
  }

  expect(calls).toBe(0);
  expect(evaluations).toBe(0);
});

test("query failures and malformed domain responses remain safe 503 errors", async () => {
  const POST = shoppingListPost(database, async () => {
    if (invalid) {
      const result = {
        evaluations: [],
        baskets: optimizeBasket([]),
        evaluatedAt: new Date().toISOString(),
        timings: { queryMs: 12, totalMs: 15 },
      };
      Reflect.deleteProperty(result, "baskets");

      return result;
    }

    throw new Error("postgres://secret@host raw payload");
  });

  for (invalid of [false, true]) {
    const response = await POST(request('{"version":2,"items":[]}'));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "No pudimos cargar los precios. Intenta nuevamente.",
    });
  }
});

test("chunked bodies stop at the byte bound and cancel unread input", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(shoppingListBodyBytes + 1));
    },
    cancel() {
      canceled = true;
    },
  });
  const streamed = new Request("http://localhost/api/list/evaluate", {
    method: "POST",
    body: stream,
    ...{ duplex: "half" },
  });
  expect((await shoppingListPost(database)(streamed)).status).toBe(413);
  expect(canceled).toBe(true);
  expect(calls).toBe(0);
});
