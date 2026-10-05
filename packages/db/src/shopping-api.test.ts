import { beforeEach, expect, it, vi } from "vitest";
import { optimizeBasket } from "@comprafino/core";
import { POST } from "../../../apps/web/src/app/api/list/evaluate/route.ts";
const mocks = vi.hoisted(() => ({
  create: vi.fn<() => undefined>(),
  evaluate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@comprafino/db", () => ({
  createDatabase: mocks.create,
  evaluateCurrentShoppingList: mocks.evaluate,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
function request(body: string, mode = "standard") {
  return new Request(`http://localhost/api/list/evaluate?priceMode=${mode}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
it("validates external list bodies before accessing the catalog", async () => {
  for (const body of ["{", "null", '{"version":3,"items":[]}', '{"version":2,"items":[{}]}'])
    expect((await POST(request(body))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.evaluate).not.toHaveBeenCalled();
});
it("returns a validated uncached response with DB/API timings and normalized mode", async () => {
  mocks.evaluate.mockResolvedValue({
    evaluations: [],
    baskets: optimizeBasket([]),
    evaluatedAt: new Date().toISOString(),
    timings: { queryMs: 12, totalMs: 15 },
  });
  const response = await POST(request('{"version":2,"items":[]}', "unexpected"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Server-Timing")).toContain("db;dur=12.00");
  expect(mocks.evaluate.mock.calls[0]?.[2]).toBe("standard");
});
it("query failures and malformed domain responses remain errors rather than partial baskets", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.evaluate.mockRejectedValueOnce(new Error("overflow"));
    mocks.evaluate.mockResolvedValueOnce({ evaluations: [], baskets: [] });
    for (let i = 0; i < 2; i++) {
      const response = await POST(request('{"version":2,"items":[]}'));
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "No pudimos cargar los precios. Intenta nuevamente.",
      });
    }
  } finally {
    log.mockRestore();
  }
});
