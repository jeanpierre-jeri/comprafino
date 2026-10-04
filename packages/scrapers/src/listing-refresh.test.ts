import { expect, it, vi } from "vitest";
import type { KnownListing } from "@comprafino/core";
import { refreshKnownListings } from "./listing-refresh.ts";
import type { ListingRefreshTasks } from "./listing-refresh.ts";
function row(index: number, retailer: KnownListing["retailer"] = "metro"): KnownListing {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    retailer,
    externalId: String(index),
    productId: String(index),
    url: "https://www.metro.pe/product/p",
    observedAt: new Date("2026-10-03T09:00:00Z"),
    public: true,
    firstSeenVia: "discovery",
    lastCategoryObservedAt: null,
    lastTargetedAttemptAt: null,
  };
}
function tasks(): ListingRefreshTasks {
  return {
    adapters: {
      metro: {
        lookupListing: vi
          .fn<ListingRefreshTasks["adapters"]["metro"]["lookupListing"]>()
          .mockResolvedValue({ status: "not-found" }),
      },
      "plaza-vea": {
        lookupListing: vi
          .fn<ListingRefreshTasks["adapters"]["metro"]["lookupListing"]>()
          .mockResolvedValue({ status: "not-found" }),
      },
      tottus: {
        lookupListing: vi
          .fn<ListingRefreshTasks["adapters"]["metro"]["lookupListing"]>()
          .mockResolvedValue({ status: "unavailable" }),
      },
    },
    claim: vi.fn<ListingRefreshTasks["claim"]>().mockResolvedValue(true),
    persist: vi.fn<ListingRefreshTasks["persist"]>().mockResolvedValue({ changed: 0 }),
    finish: vi.fn<ListingRefreshTasks["finish"]>().mockResolvedValue(undefined),
    pause: vi.fn<ListingRefreshTasks["pause"]>().mockResolvedValue(undefined),
  };
}
it("retains expected missing/unavailable listings without price writes or failures", async () => {
  const t = tasks();
  const result = await refreshKnownListings([row(1), row(2, "tottus")], t);
  expect(result).toMatchObject({ requests: 2, failures: 0, status: "success" });
  expect(t.persist).not.toHaveBeenCalled();
  expect(t.finish).toHaveBeenCalledTimes(2);
  expect(t.pause).toHaveBeenCalledOnce();
});
it("isolates individual system failures and continues remaining lookups", async () => {
  const t = tasks();
  vi.mocked(t.adapters.metro.lookupListing).mockRejectedValueOnce(new Error("secret"));
  const result = await refreshKnownListings([row(1), row(2), row(3)], t);
  expect(result).toMatchObject({ requests: 3, failures: 1, status: "partial" });
  expect(result.results.map((r) => r.status)).toEqual(["failed", "not-found", "not-found"]);
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("stops a broadly failing retailer after three consecutive errors and continues other retailers", async () => {
  const t = tasks();
  vi.mocked(t.adapters.metro.lookupListing).mockRejectedValue(new Error("offline"));
  const result = await refreshKnownListings(
    [row(1), row(2), row(3), row(4), row(5, "plaza-vea")],
    t,
  );
  expect(result).toMatchObject({ requests: 4, failures: 3 });
  expect(result.results.map((r) => r.status)).toEqual([
    "failed",
    "failed",
    "failed",
    "skipped",
    "not-found",
  ]);
});
it("validates exact listing identity and never persists unrelated results", async () => {
  const t = tasks();
  vi.mocked(t.adapters.metro.lookupListing).mockResolvedValue({
    status: "observed",
    listing: {
      retailer: "metro",
      externalId: "wrong",
      productId: "1",
      title: "Product",
      url: "https://www.metro.pe/product/p",
      currentPriceCents: 100,
      currency: "PEN",
      priceUnit: "UN",
      observedAt: new Date(),
    },
  });
  expect((await refreshKnownListings([row(1)], t)).failures).toBe(1);
  expect(t.persist).not.toHaveBeenCalled();
});
it("skips concurrent or newer observations refused by admission", async () => {
  const t = tasks();
  vi.mocked(t.claim).mockResolvedValue(false);
  expect((await refreshKnownListings([row(1)], t)).requests).toBe(0);
  expect(t.adapters.metro.lookupListing).not.toHaveBeenCalled();
});
