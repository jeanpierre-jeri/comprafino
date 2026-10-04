import { describe, expect, it, vi } from "vitest";
import type { NormalizedRetailerListing, RetailerId } from "@comprafino/core";
import { processDiscoveryQuery } from "./discovery.ts";
import type { SearchRetailerAdapter } from "./adapter.ts";
import type { DiscoveryTasks } from "./discovery.ts";

const claim = {
  id: "00000000-0000-4000-8000-000000000001",
  query: "aceite primor",
  attemptedAt: new Date("2026-10-03T00:00:00Z"),
};
const listing = (retailer: RetailerId, i = 0): NormalizedRetailerListing => ({
  retailer,
  externalId: String(i),
  productId: String(i),
  title: "Aceite Primor 1L",
  url:
    retailer === "tottus"
      ? "https://www.tottus.com.pe/tottus-pe/articulo/1/test"
      : `https://${retailer === "metro" ? "www.metro.pe" : "www.plazavea.com.pe"}/test/p`,
  currentPriceCents: 1000,
  currency: "PEN",
  priceUnit: "UN",
  observedAt: claim.attemptedAt,
});
function setup(failures: RetailerId[] = [], empty = false) {
  const adapters = (["tottus", "plaza-vea", "metro"] as const).map((retailer) => ({
    retailer,
    lookupListing: async () => ({ status: "not-found" as const }),
    fetchListings: vi.fn<SearchRetailerAdapter["fetchListings"]>(),
    searchProducts: vi.fn<SearchRetailerAdapter["searchProducts"]>(async () => {
      if (failures.includes(retailer)) throw new Error("postgresql://secret@host/password");
      return { listings: empty ? [] : [listing(retailer)], discovered: empty ? 0 : 1 };
    }),
  }));
  const tasks = {
    adapters,
    persist: vi.fn<DiscoveryTasks["persist"]>(async () => ({ created: 1, changed: 1 })),
    normalize: vi.fn<DiscoveryTasks["normalize"]>(async () => 3),
    match: vi.fn<DiscoveryTasks["match"]>(async () => ({ writes: 3, created: 1 })),
    finish: vi.fn<DiscoveryTasks["finish"]>(async () => {}),
  } satisfies DiscoveryTasks;
  return tasks;
}
describe("bounded discovery processing", () => {
  it("persists through ingestion, then normalizes and matches", async () => {
    const tasks = setup();
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r).toMatchObject({
      status: "completed",
      resultCount: 3,
      retailerSearchCalls: 3,
      newListings: 3,
      normalizationWrites: 3,
      matchingWrites: 3,
      canonicalGroupsCreated: 1,
    });
    expect(tasks.persist).toHaveBeenCalledTimes(3);
    expect(tasks.normalize.mock.invocationCallOrder[0]).toBeGreaterThan(
      tasks.persist.mock.invocationCallOrder[2]!,
    );
    expect(tasks.match.mock.invocationCallOrder[0]).toBeGreaterThan(
      tasks.normalize.mock.invocationCallOrder[0]!,
    );
    expect(tasks.finish).toHaveBeenCalledWith(claim, {
      status: "completed",
      resultCount: 3,
      error: null,
    });
    for (const a of tasks.adapters) expect(a.searchProducts).toHaveBeenCalledWith(claim.query, 10);
  });
  it("preserves successful retailers on a partial failure and reports a safe error", async () => {
    const tasks = setup(["plaza-vea"]);
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r).toMatchObject({
      status: "partial",
      resultCount: 2,
      error: "Retailer discovery failed.",
    });
    expect(tasks.persist).toHaveBeenCalledTimes(2);
    expect(tasks.match).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("records all-retailer failure without downstream writes", async () => {
    const tasks = setup(["tottus", "plaza-vea", "metro"]);
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r.status).toBe("failed");
    expect(tasks.persist).not.toHaveBeenCalled();
    expect(tasks.normalize).not.toHaveBeenCalled();
  });
  it("distinguishes successful zero results from failure", async () => {
    const tasks = setup([], true);
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r).toMatchObject({ status: "no_results", error: null, resultCount: 0 });
    expect(tasks.persist).not.toHaveBeenCalled();
    expect(tasks.match).not.toHaveBeenCalled();
    expect(tasks.finish).toHaveBeenCalledOnce();
  });
  it("does not report complete success if empty searches include a failure", async () => {
    expect((await processDiscoveryQuery(claim, setup(["metro"], true))).status).toBe("partial");
  });
  it("bounds and deduplicates an adapter's oversized output", async () => {
    const tasks = setup();
    tasks.adapters[0]!.searchProducts.mockResolvedValue({
      listings: [listing("tottus"), ...Array.from({ length: 25 }, (_, i) => listing("tottus", i))],
      discovered: 26,
    });
    const r = await processDiscoveryQuery(claim, tasks);
    expect(tasks.persist.mock.calls[0]?.[1]).toHaveLength(10);
    expect(r.resultCount).toBe(12);
  });
  it("retains persisted results and records derivation failure safely", async () => {
    const tasks = setup();
    tasks.normalize.mockRejectedValue(new Error("password"));
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r).toMatchObject({
      status: "failed",
      resultCount: 3,
      error: "Catalog derivation failed.",
    });
    expect(tasks.match).not.toHaveBeenCalled();
  });
  it("delegates idempotency to existing persistence and derivation APIs", async () => {
    const tasks = setup();
    tasks.persist.mockResolvedValue({ created: 0, changed: 0 });
    tasks.normalize.mockResolvedValue(0);
    tasks.match.mockResolvedValue({ writes: 0, created: 0 });
    expect(await processDiscoveryQuery(claim, tasks)).toMatchObject({
      newListings: 0,
      normalizationWrites: 0,
      matchingWrites: 0,
      canonicalGroupsCreated: 0,
    });
  });
  it("rejects missing coverage", async () => {
    const tasks = setup();
    tasks.adapters.pop();
    await expect(processDiscoveryQuery(claim, tasks)).rejects.toThrow(
      "Discovery requires the three existing retailers",
    );
  });
});
