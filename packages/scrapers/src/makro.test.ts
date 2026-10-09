import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/makro.json";
import { createMakroAdapter, parseMakroPage } from "./makro.ts";
import { parsePlazaVeaPage } from "./plaza-vea.ts";
import { parseArguments } from "./cli-options.ts";
import { combineVtexCoverage, scheduledObservationLimit } from "./refresh-adapters.ts";
import type { RetailerAdapter } from "./adapter.ts";
import { ingest } from "./ingestion.ts";
import type { IngestionStore } from "./ingestion.ts";

const observedAt = new Date("2026-10-08T18:00:00Z");
const response = (rows: unknown, range = "0-8/9") =>
  new Response(JSON.stringify(rows), { status: 206, headers: { resources: range } });
const requestedUrl = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : input);
const known = {
  id: "00000000-0000-4000-8000-000000000001",
  retailer: "makro" as const,
  externalId: "11390020",
  productId: "101021448",
  url: fixture[0]!.link,
  observedAt,
  public: false,
  firstSeenVia: "category" as const,
  lastCategoryObservedAt: observedAt,
  lastTargetedAttemptAt: null,
};

describe("sanitized live Makro channel-9 evidence", () => {
  it("keeps ordinary pack prices separate from quantity/payment teasers", () => {
    const result = parseMakroPage(fixture, observedAt);
    expect(result.discovered).toBe(9);
    expect(result.listings[0]).toMatchObject({
      retailer: "makro",
      externalId: "11390020",
      productId: "101021448",
      currentPriceCents: 2330,
      priceUnit: "UN",
      packageText: "Paquete 6un",
      sourceBrand: "GLORIA",
      sourceUnitMultiplier: 1,
      available: true,
      url: fixture[0]!.link,
      observedAt,
    });
    expect(result.listings[0]?.regularPriceCents).toBeUndefined();
    expect(result.listings[0]?.conditionalOffers).toBeUndefined();
    expect(result.listings[2]).toMatchObject({ currentPriceCents: 1779, category: "444" });
    // Per-kg quote stays per kg despite the source sale multiplier of 1.9 kg.
    expect(result.listings[8]).toMatchObject({
      currentPriceCents: 1150,
      priceUnit: "KG",
      sourceUnitMultiplier: 1.9,
    });
  });

  it("isolates retailer identity even when Makro and Plaza Vea share SKU numbers", () => {
    expect(() => parsePlazaVeaPage(fixture, observedAt)).toThrow("product URL");
    const plaza = fixture.map((row) => ({
      ...row,
      link: row.link.replace("www.makro.plazavea", "www.plazavea"),
    }));
    expect(() => parseMakroPage(plaza, observedAt)).toThrow("product URL");
    expect(parsePlazaVeaPage(plaza, observedAt).listings[0]?.externalId).toBe(
      parseMakroPage(fixture, observedAt).listings[0]?.externalId,
    );
  });

  it.each([0, -1, 2.001])("rejects unusable ordinary price %s", (price) => {
    const data = structuredClone(fixture);
    data[0]!.items[0]!.sellers[0]!.commertialOffer.Price = price;
    expect(() => parseMakroPage(data, observedAt)).toThrow(/Invalid|Unexpected|Too small/u);
  });

  it("retains only higher references and rejects ambiguous units, sellers and taxes", () => {
    const data = structuredClone(fixture);
    const item = data[0]!.items[0]!;
    const offer = item.sellers[0]!.commertialOffer;
    offer.ListPrice = 25;
    expect(parseMakroPage(data, observedAt).listings[0]?.regularPriceCents).toBe(2500);
    offer.ListPrice = 20;
    expect(parseMakroPage(data, observedAt).listings[0]?.regularPriceCents).toBeUndefined();
    item.unitMultiplier = 6;
    expect(() => parseMakroPage(data, observedAt)).toThrow("unit multiplier");
    item.unitMultiplier = 1;
    offer.Tax = 1;
    expect(() => parseMakroPage(data, observedAt)).toThrow(/Invalid|Unexpected|Too small/u);
    offer.Tax = 0;
    expect(() =>
      parseMakroPage(
        [{ ...data[0], items: [{ ...item, sellers: [item.sellers[0], item.sellers[0]] }] }],
        observedAt,
      ),
    ).toThrow("Ambiguous");
  });

  it("skips unavailable placeholders and non-store sellers without making up prices", () => {
    const data = structuredClone(fixture);
    Object.assign(data[0]!.items[0]!.sellers[0]!.commertialOffer, {
      IsAvailable: false,
      Price: 0,
      AvailableQuantity: 0,
    });
    data[1]!.items[0]!.sellers[0]!.sellerId = "marketplace";
    expect(parseMakroPage(data, observedAt).listings).toHaveLength(7);
  });
});

describe("bounded Makro acquisition and exact refresh", () => {
  it.each([
    "dairy",
    "sugar-brown",
    "sugar-white",
    "pasta",
    "flour",
    "oats",
    "toilet-paper",
  ] as const)(
    "uses the own origin/channel for %s and validates terminal ranges",
    async (category) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response(fixture, "0-19/9"));
      const result = await createMakroAdapter(request, category).fetchListings(20);
      expect(result.listings).toHaveLength(9);
      expect(request).toHaveBeenCalledOnce();
      const url = requestedUrl(request.mock.calls[0]![0]);
      expect(url.origin).toBe("https://www.makro.plazavea.com.pe");
      expect(url.searchParams.get("sc")).toBe("9");
      expect(url.searchParams.get("fq")).toMatch(/^C:\//u);
    },
  );

  it("searches one bounded page and looks up an exact SKU with channel 9", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response([fixture[0]], "0-0/1"));
    const adapter = createMakroAdapter(request);
    expect((await adapter.searchProducts("leche gloria", 10)).listings).toHaveLength(1);
    expect((await adapter.lookupListing(known)).status).toBe("observed");
    const searchUrl = requestedUrl(request.mock.calls[0]![0]);
    expect(searchUrl.searchParams.get("ft")).toBe("leche gloria");
    expect(searchUrl.href).toContain("leche%20gloria");
    expect(searchUrl.searchParams.get("sc")).toBe("9");
    const lookupUrl = requestedUrl(request.mock.calls[1]![0]);
    expect(lookupUrl.searchParams.get("fq")).toBe("skuId:11390020");
    expect(lookupUrl.searchParams.get("sc")).toBe("9");
    expect(lookupUrl.searchParams.get("_to")).toBe("0");
  });

  it("distinguishes missing/unavailable SKU evidence from unknown seller and changed identity", async () => {
    const data = structuredClone(fixture[0]!);
    const request = vi.fn<typeof fetch>();
    const adapter = createMakroAdapter(request);
    request.mockResolvedValueOnce(response([]));
    expect(await adapter.lookupListing(known)).toEqual({ status: "not-found" });
    Object.assign(data.items[0]!.sellers[0]!.commertialOffer, { IsAvailable: false, Price: 0 });
    request.mockResolvedValueOnce(response([data]));
    expect(await adapter.lookupListing(known)).toEqual({ status: "unavailable" });
    data.items[0]!.sellers = [];
    request.mockResolvedValueOnce(response([data]));
    await expect(adapter.lookupListing(known)).rejects.toThrow("availability evidence");
    request.mockResolvedValueOnce(response([{ ...data, productId: "999" }]));
    await expect(adapter.lookupListing(known)).rejects.toThrow("identity changed");
  });

  it("rejects invalid bounds/categories before fetching and stops restrictions without retries", async () => {
    const request = vi.fn<typeof fetch>();
    for (const limit of [0, 501, 1.5]) {
      await expect(createMakroAdapter(request).fetchListings(limit)).rejects.toThrow("Limit");
    }
    expect(() => createMakroAdapter(request, "eggs")).toThrow("Unsupported");
    await expect(createMakroAdapter(request, "pasta").fetchListings(21)).rejects.toThrow("Limit");
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue(new Response("restricted", { status: 401 }));
    await expect(createMakroAdapter(request).fetchListings(20)).rejects.toThrow("HTTP 401");
    expect(request).toHaveBeenCalledOnce();
    expect(parseArguments(["--retailer=makro", "--dry-run", "--category=pasta"])).toMatchObject({
      retailer: "makro",
      category: "pasta",
      dryRun: true,
    });
    expect(() => parseArguments(["--retailer=makro", "--category=eggs"])).toThrow("Metro only");
  });

  it("deduplicates all scheduled categories before one atomic Makro persistence", async () => {
    const rows = parseMakroPage(fixture, observedAt).listings;
    const fetchListings = vi
      .fn<RetailerAdapter["fetchListings"]>()
      .mockResolvedValue({ listings: rows, discovered: 9 });
    const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const adapter = combineVtexCoverage(
      "makro",
      () => ({ retailer: "makro", fetchListings }),
      pause,
    );
    const store = {
      start: vi.fn<IngestionStore["start"]>().mockResolvedValue("makro-run"),
      persist: vi.fn<IngestionStore["persist"]>().mockResolvedValue({ persisted: 9, changed: 9 }),
      finish: vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined),
    };
    await ingest(adapter, scheduledObservationLimit("makro"), store);
    expect(fetchListings.mock.calls.map(([limit]) => limit)).toEqual([100, 20, 20, 20, 20, 20, 20]);
    expect(pause).toHaveBeenCalledTimes(6);
    expect(store.persist).toHaveBeenCalledExactlyOnceWith("makro", rows);
    store.persist.mockClear();
    fetchListings.mockRejectedValueOnce(new Error("restricted"));
    await expect(ingest(adapter, 220, store)).rejects.toThrow("Retailer request failed.");
    expect(store.persist).not.toHaveBeenCalled();
  });
});
