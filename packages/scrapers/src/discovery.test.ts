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
  const adapters = (["tottus", "plaza-vea", "metro", "makro"] as const).map((retailer) => ({
    retailer,
    lookupListing: async () => ({ status: "not-found" as const }),
    fetchListings: vi.fn<SearchRetailerAdapter["fetchListings"]>(),
    searchProducts: vi.fn<SearchRetailerAdapter["searchProducts"]>(async () => {
      if (failures.includes(retailer)) {
        throw new Error("postgresql://secret@host/password");
      }

      return { listings: empty ? [] : [listing(retailer)], discovered: empty ? 0 : 1 };
    }),
  }));
  const tasks = {
    adapters,
    persist: vi.fn<DiscoveryTasks["persist"]>(async () => ({
      created: 1,
      changed: 1,
      skippedByCapacity: 0,
    })),
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
      resultCount: 4,
      retailerSearchCalls: 4,
      newListings: 4,
      normalizationWrites: 3,
      matchingWrites: 3,
      canonicalGroupsCreated: 1,
    });
    expect(tasks.persist).toHaveBeenCalledTimes(4);
    expect(tasks.normalize.mock.invocationCallOrder[0]).toBeGreaterThan(
      tasks.persist.mock.invocationCallOrder[3]!,
    );
    expect(tasks.match.mock.invocationCallOrder[0]).toBeGreaterThan(
      tasks.normalize.mock.invocationCallOrder[0]!,
    );
    expect(tasks.finish).toHaveBeenCalledWith(claim, {
      status: "completed",
      resultCount: 4,
      error: null,
    });

    for (const a of tasks.adapters) {
      expect(a.searchProducts).toHaveBeenCalledWith(claim.query, 10);
    }
  });
  it("preserves successful retailers on a partial failure and reports a safe error", async () => {
    const tasks = setup(["plaza-vea"]);
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r).toMatchObject({
      status: "partial",
      resultCount: 3,
      error: "Retailer discovery failed.",
    });
    expect(tasks.persist).toHaveBeenCalledTimes(3);
    expect(tasks.match).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("records all-retailer failure without downstream writes", async () => {
    const tasks = setup(["tottus", "plaza-vea", "metro", "makro"]);
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
    expect(r.resultCount).toBe(13);
  });
  it("retains persisted results and records derivation failure safely", async () => {
    const tasks = setup();
    tasks.normalize.mockRejectedValue(new Error("password"));
    const r = await processDiscoveryQuery(claim, tasks);
    expect(r).toMatchObject({
      status: "failed",
      resultCount: 4,
      error: "Catalog derivation failed.",
    });
    expect(tasks.match).not.toHaveBeenCalled();
  });
  it("delegates idempotency to existing persistence and derivation APIs", async () => {
    const tasks = setup();
    tasks.persist.mockResolvedValue({ created: 0, changed: 0, skippedByCapacity: 0 });
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
      "Discovery requires all registered retailers",
    );
  });
});

it("distinguishes source timeout, persistence and derivation failures without exposing their causes", async () => {
  const tasks = setup();
  const timeout = new Error("private query and URL");
  timeout.name = "TimeoutError";
  tasks.adapters[0]!.searchProducts.mockRejectedValue(timeout);
  tasks.persist.mockRejectedValueOnce(
    Object.assign(new Error("postgres://password@db"), { code: "23514" }),
  );
  tasks.match.mockRejectedValue(new Error("raw retailer body"));
  const result = await processDiscoveryQuery(claim, tasks);
  expect(result.retailers[0]?.diagnostic).toMatchObject({
    stage: "source",
    retailer: "tottus",
    reason: "source_timeout",
  });
  expect(result.retailers[1]?.diagnostic).toMatchObject({
    stage: "persistence",
    retailer: "plaza-vea",
    reason: "db_write_failed",
    databaseCode: "23514",
  });
  expect(result.diagnostic).toMatchObject({
    stage: "matching",
    operation: "discovery",
    reason: "db_write_failed",
  });
  expect(JSON.stringify(result)).not.toMatch(/private|password|raw retailer/u);
});

it("reports capacity-limited discovery without treating it as a retailer failure", async () => {
  const tasks = setup();
  tasks.persist.mockResolvedValue({ created: 0, changed: 0, skippedByCapacity: 1 });
  const result = await processDiscoveryQuery(claim, tasks);
  expect(result).toMatchObject({
    status: "completed",
    resultCount: 0,
    error: null,
    skippedByCapacity: 4,
  });
  expect(result.retailers.every((r) => r.status === "success" && r.skippedByCapacity === 1)).toBe(
    true,
  );
  expect(tasks.normalize).not.toHaveBeenCalled();
  expect(tasks.match).not.toHaveBeenCalled();
  expect(tasks.finish).toHaveBeenCalledWith(claim, {
    status: "completed",
    resultCount: 0,
    error: null,
  });
});

it("derives accepted listings when part of a discovery batch is skipped at capacity", async () => {
  const tasks = setup([], true);
  tasks.adapters[0]!.searchProducts.mockResolvedValue({
    listings: [listing("tottus", 1), listing("tottus", 2), listing("tottus", 3)],
    discovered: 3,
  });
  tasks.persist.mockResolvedValue({ created: 2, changed: 2, skippedByCapacity: 1 });
  expect(await processDiscoveryQuery(claim, tasks)).toMatchObject({
    status: "completed",
    resultCount: 2,
    newListings: 2,
    skippedByCapacity: 1,
  });
  expect(tasks.normalize).toHaveBeenCalledOnce();
  expect(tasks.match).toHaveBeenCalledOnce();
});

it("spends the last available slot on the requested brand rather than retailer suggestions", async () => {
  const tasks = setup([], true);
  const requested = { ...listing("tottus", 12), title: "Queso Edam 400 g", sourceBrand: "TOTTUS" };
  tasks.adapters[0]!.searchProducts.mockResolvedValue({
    listings: [
      ...Array.from({ length: 11 }, (_, index) => ({
        ...listing("tottus", index),
        title: "Queso Edam Vonk x Kg",
        sourceBrand: "VONK",
      })),
      requested,
    ],
    discovered: 12,
  });
  const result = await processDiscoveryQuery({ ...claim, query: "queso edam tottus" }, tasks);
  expect(tasks.persist).toHaveBeenCalledExactlyOnceWith("tottus", [requested], expect.anything());
  expect(result).toMatchObject({ status: "completed", newListings: 1, resultCount: 1 });
});

it("does not persist unrelated brands or claim coverage when the source only returns suggestions", async () => {
  const tasks = setup();
  const result = await processDiscoveryQuery({ ...claim, query: "queso edam aro" }, tasks);
  expect(result).toMatchObject({ status: "no_results", resultCount: 0, newListings: 0 });
  expect(tasks.persist).not.toHaveBeenCalled();
  expect(tasks.normalize).not.toHaveBeenCalled();
  expect(tasks.match).not.toHaveBeenCalled();
});
