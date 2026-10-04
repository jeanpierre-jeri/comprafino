import { expect, it, vi } from "vitest";
import { refreshCatalog, parseRefreshOptions } from "./refresh.ts";
import type { RefreshTasks } from "./refresh.ts";
import { combineTottusCoverage, refreshCoverage } from "./refresh-adapters.ts";
import { ingest } from "./ingestion.ts";
import type { RetailerAdapter } from "./adapter.ts";
import type { IngestionStore } from "./ingestion.ts";
import { parseTottusPage } from "./tottus.ts";
import fixture from "./fixtures/tottus.json";
function tasks() {
  return {
    ingest: vi
      .fn<RefreshTasks["ingest"]>()
      .mockResolvedValue({ fetched: 120, persisted: 100, changed: 0 }),
    normalize: vi.fn<RefreshTasks["normalize"]>().mockResolvedValue({ processed: 351, changed: 0 }),
    match: vi
      .fn<RefreshTasks["match"]>()
      .mockResolvedValue({ candidates: 7278, associationsChanged: 0, productsChanged: 0 }),
  };
}
it("completes a full refresh in ingestion → normalization → matching order", async () => {
  const t = tasks();
  const events: string[] = [];
  const result = await refreshCatalog(t, false, (e) => events.push(`${e.stage}:${e.status}`));
  expect(result.status).toBe("success");
  expect(t.ingest.mock.calls).toEqual([["tottus"], ["plaza-vea"], ["metro"]]);
  expect(events).toEqual([
    "tottus:started",
    "tottus:success",
    "plaza-vea:started",
    "plaza-vea:success",
    "metro:started",
    "metro:success",
    "normalization:started",
    "normalization:success",
    "matching:started",
    "matching:success",
    "overall:success",
  ]);
});
it("isolates partial failure, continues downstream, returns failure, and never leaks errors", async () => {
  const t = tasks();
  t.ingest.mockImplementation(async (retailer) => {
    if (retailer === "plaza-vea")
      throw new Error("DATABASE_URL=postgres://user:password@secret/db?token=secret");
    return { fetched: 100, persisted: 100, changed: 0 };
  });
  const result = await refreshCatalog(t);
  expect(result.status).toBe("failed");
  expect(result.retailers.map((r) => r.outcome.status)).toEqual(["success", "failed", "success"]);
  expect(t.normalize).toHaveBeenCalledOnce();
  expect(t.match).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain("password");
});
it("skips downstream writes when all retailers fail", async () => {
  const t = tasks();
  t.ingest.mockRejectedValue(new Error("offline"));
  expect(await refreshCatalog(t)).toMatchObject({
    status: "failed",
    normalization: { status: "skipped" },
    matching: { status: "skipped" },
  });
  expect(t.ingest).toHaveBeenCalledTimes(3);
  expect(t.normalize).not.toHaveBeenCalled();
  expect(t.match).not.toHaveBeenCalled();
});
it("normalization failure prevents matching and reports only a safe summary", async () => {
  const t = tasks();
  t.normalize.mockRejectedValue(new Error("secret driver detail"));
  const result = await refreshCatalog(t);
  expect(result).toMatchObject({
    status: "failed",
    normalization: { status: "failed" },
    matching: { status: "skipped" },
  });
  expect(t.match).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("secret driver");
});
it("matching failure is visible without retrying derived writes", async () => {
  const t = tasks();
  t.match.mockRejectedValue(new Error("driver detail"));
  expect(await refreshCatalog(t)).toMatchObject({
    status: "failed",
    matching: { status: "failed" },
  });
  expect(t.match).toHaveBeenCalledOnce();
});
it("dry run fetches all retailers and never calls downstream persistence", async () => {
  const t = tasks();
  expect((await refreshCatalog(t, true)).status).toBe("success");
  expect(t.ingest).toHaveBeenCalledTimes(3);
  expect(t.normalize).not.toHaveBeenCalled();
  expect(t.match).not.toHaveBeenCalled();
});
it("accepts only the documented optional dry-run flag", () => {
  expect(parseRefreshOptions(["--", "--dry-run"])).toEqual({ dryRun: true });
  expect(parseRefreshOptions([])).toEqual({ dryRun: false });
  expect(() => parseRefreshOptions(["--limit=500"])).toThrow("Use pnpm refresh:catalog");
  expect(() => parseRefreshOptions(["--dry-run", "--dry-run"])).toThrow("Use pnpm refresh:catalog");
});
it("freezes validated category limits and persists neither Tottus category on a fetch failure", async () => {
  const listings = parseTottusPage(
    `<script id="__NEXT_DATA__">${JSON.stringify(fixture)}</script>`,
    new Date(),
  ).listings;
  const meatFetch = vi
    .fn<RetailerAdapter["fetchListings"]>()
    .mockResolvedValue({ listings, discovered: 49 });
  const dairyFetch = vi
    .fn<RetailerAdapter["fetchListings"]>()
    .mockRejectedValue(new Error("restricted"));
  const persist = vi.fn<IngestionStore["persist"]>();
  const finish = vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined);
  const adapter = combineTottusCoverage(
    { retailer: "tottus", fetchListings: meatFetch },
    { retailer: "tottus", fetchListings: dairyFetch },
  );
  await expect(ingest(adapter, 150, { start: async () => "id", persist, finish })).rejects.toThrow(
    "restricted",
  );
  expect(meatFetch).toHaveBeenCalledWith(50);
  expect(dairyFetch).toHaveBeenCalledWith(100);
  expect(persist).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith(
    "id",
    expect.objectContaining({ status: "failed", persisted: 0 }),
  );
  expect(refreshCoverage).toEqual({
    tottus: { meat: 50, dairy: 100 },
    "plaza-vea": { dairy: 100 },
    metro: { dairy: 100 },
  });
});
it("combines and deduplicates Tottus categories before atomic persistence", async () => {
  const listings = parseTottusPage(
    `<script id="__NEXT_DATA__">${JSON.stringify(fixture)}</script>`,
    new Date(),
  ).listings;
  const a = {
    retailer: "tottus" as const,
    fetchListings: async () => ({ listings, discovered: 49 }),
  };
  const result = await combineTottusCoverage(a, a).fetchListings(150);
  expect(result.discovered).toBe(98);
  expect(result.listings).toEqual(listings);
});

it("reruns both derived stages for unchanged ingestion and reports zero unnecessary writes", async () => {
  const t = tasks();
  const first = await refreshCatalog(t);
  const second = await refreshCatalog(t);
  for (const result of [first, second]) {
    expect(result).toMatchObject({
      status: "success",
      normalization: { result: { changed: 0 } },
      matching: { result: { associationsChanged: 0, productsChanged: 0 } },
    });
    expect(
      result.retailers.every(
        (r) => r.outcome.status === "success" && r.outcome.result.changed === 0,
      ),
    ).toBe(true);
  }
  expect(t.normalize).toHaveBeenCalledTimes(2);
  expect(t.match).toHaveBeenCalledTimes(2);
});
