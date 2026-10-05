import { expect, it, vi } from "vitest";
import { ingest } from "./ingestion.ts";
import type { IngestionStore } from "./ingestion.ts";
import type { RetailerAdapter } from "./adapter.ts";
import fixture from "./fixtures/tottus.json";
import { parseTottusPage } from "./tottus.ts";
const sample = parseTottusPage(
  `<script id="__NEXT_DATA__">${JSON.stringify(fixture)}</script>`,
  new Date(),
);
it("records discovered, persisted and changed counts separately", async () => {
  const adapter: RetailerAdapter = {
    retailer: "tottus",
    fetchListings: async () => ({ listings: sample.listings, discovered: 49 }),
  };
  const finish = vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined);
  const store: IngestionStore = {
    start: async () => "run1",
    persist: async () => ({ persisted: 5, changed: 2 }),
    finish,
  };
  expect(await ingest(adapter, 5, store)).toEqual({
    id: "run1",
    fetched: 49,
    persisted: 5,
    changed: 2,
  });
  expect(finish).toHaveBeenCalledWith("run1", {
    status: "success",
    fetched: 49,
    persisted: 5,
    changed: 2,
  });
});
it("records a safe failed run without persisting failed source data", async () => {
  const adapter: RetailerAdapter = {
    retailer: "tottus",
    fetchListings: async () => {
      throw new Error("source unavailable");
    },
  };
  const persist = vi.fn<IngestionStore["persist"]>();
  const finish = vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined);
  await expect(ingest(adapter, 20, { start: async () => "run1", persist, finish })).rejects.toThrow(
    "Retailer request failed.",
  );
  expect(persist).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith(
    "run1",
    expect.objectContaining({ status: "failed", persisted: 0 }),
  );
});
it("retains persistence stage in safe run metadata and preserves the original exception as cause", async () => {
  const failure = Object.assign(new Error("postgres://secret@host private source"), {
    code: "23514",
  });
  const adapter: RetailerAdapter = {
    retailer: "tottus",
    fetchListings: async () => ({ listings: sample.listings, discovered: 49 }),
  };
  const finish = vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined);
  await expect(
    ingest(adapter, 5, {
      start: async () => "run1",
      persist: async () => {
        throw failure;
      },
      finish,
    }),
  ).rejects.toMatchObject({
    cause: failure,
    diagnostic: {
      stage: "persistence",
      operation: "ingestion",
      retailer: "tottus",
      reason: "db_write_failed",
      databaseCode: "23514",
    },
  });
  const metadata = finish.mock.calls[0]?.[1].error;
  expect(metadata).toContain('"reason":"db_write_failed"');
  expect(metadata).not.toMatch(/secret|private/u);
});
