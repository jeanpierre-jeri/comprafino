import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/metro.json";
import { createMetroAdapter, parseMetroPage } from "./metro.ts";
import { ingest } from "./ingestion.ts";
import type { IngestionStore } from "./ingestion.ts";

const observed = new Date("2026-10-03T17:00:00Z");
const requestedUrl = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? new URL(input.url) : new URL(input);
const response = (data: unknown, range = "0-5/6") =>
  new Response(JSON.stringify(data), { status: 206, headers: { resources: range } });
const sample = () => structuredClone(fixture[0]!);

describe("sanitized captured Metro catalog", () => {
  it("keeps SKU identity, ordinary price, reference, URL, image and source package labels", () => {
    const result = parseMetroPage(fixture, observed);
    expect(result.discovered).toBe(6);
    expect(result.listings).toHaveLength(6);
    expect(result.listings[0]).toMatchObject({
      retailer: "metro",
      externalId: "39233309",
      productId: "994699",
      title: "Sixpack Leche Reconstituida Gloria Lata 390g",
      currentPriceCents: 2150,
      regularPriceCents: 2460,
      currency: "PEN",
      priceUnit: "UN",
      available: true,
      category: "1001438",
      observedAt: observed,
      url: fixture[0]!.link,
      imageUrl: fixture[0]!.items[0]!.images[0]!.imageUrl,
      packageText: "Formato: Líquido; Pack-Unitario: Pack",
    });
    // Captured teaser has 5% off for payment method/BIN conditions. Ignore it.
    expect(fixture[0]!.items[0]!.sellers[0]!.commertialOffer.PromotionTeasers).toHaveLength(1);
    expect(result.listings[1]?.regularPriceCents).toBeUndefined();
    expect(result.listings[2]).toMatchObject({
      title: "Yogurt Bebible Gloria Fresa Galonera 1.6kg",
      currentPriceCents: 990,
    });
    expect(result.listings[3]).toMatchObject({
      externalId: "39271375",
      currentPriceCents: 770,
      regularPriceCents: 990,
      priceUnit: "KG",
      packageText: "unitMultiplier: 1.9 kg",
    });
    expect(result.listings[4]?.packageText).toBe(
      "Envase: Lata; Formato: Envasado; Tamaño: Individual; Pack-Unitario: Pack",
    );
  });

  it.each([24.6, 21.5, 20, 0, undefined])(
    "keeps only higher meaningful reference price %s",
    (reference) => {
      const product = sample();
      const offer = product.items[0]!.sellers[0]!.commertialOffer;
      const data = {
        ...product,
        items: [
          {
            ...product.items[0]!,
            sellers: [{ sellerId: "1", commertialOffer: { ...offer, ListPrice: reference } }],
          },
        ],
      };
      const listing = parseMetroPage([data], observed).listings[0];
      expect(listing?.currentPriceCents).toBe(2150);
      expect(listing?.regularPriceCents).toBe(
        reference !== undefined && reference > 21.5 ? 2460 : undefined,
      );
    },
  );

  it("accepts omitted optional fields and parses decimal cents without guessing from titles", () => {
    const product = sample();
    const item = product.items[0]!;
    const offer = item.sellers[0]!.commertialOffer;
    const listing = parseMetroPage(
      [
        {
          ...product,
          link: `${new URL(product.link).pathname}?tracking=1#fragment`,
          Envase: undefined,
          Formato: undefined,
          Tamaño: undefined,
          "Pack-Unitario": undefined,
          categoryId: undefined,
          items: [
            {
              ...item,
              images: undefined,
              name: "  Sixpack\n Milk 390g ",
              sellers: [
                { sellerId: "1", commertialOffer: { ...offer, Price: 0.29, ListPrice: undefined } },
              ],
            },
          ],
        },
      ],
      observed,
    ).listings[0];
    expect(listing).toMatchObject({
      currentPriceCents: 29,
      title: "Sixpack Milk 390g",
      url: product.link,
    });
    for (const key of ["packageText", "imageUrl", "category", "regularPriceCents"] as const)
      expect(listing?.[key]).toBeUndefined();
  });

  it("preserves separate SKU variants and ignores cheaper non-retailer sellers", () => {
    const product = sample();
    const item = product.items[0]!;
    item.sellers.unshift({
      ...item.sellers[0]!,
      sellerId: "marketplace",
      commertialOffer: { ...item.sellers[0]!.commertialOffer, Price: 1 },
    });
    product.items.push({ ...item, itemId: "999999", name: "Separate variant" });
    const result = parseMetroPage([product], observed);
    expect(result.discovered).toBe(1);
    expect(result.listings.map((l) => [l.externalId, l.currentPriceCents])).toEqual([
      ["39233309", 2150],
      ["999999", 2150],
    ]);
  });

  it("skips unavailable/zero-quantity placeholders and non-seller-1 offers", () => {
    // Synthetic unavailable cases; the investigation captured no unavailable product.
    const data = structuredClone(fixture);
    Object.assign(data[0]!.items[0]!.sellers[0]!.commertialOffer, {
      IsAvailable: false,
      Price: 0,
      AvailableQuantity: 0,
    });
    data[1]!.items[0]!.sellers[0]!.commertialOffer.AvailableQuantity = 0;
    data[5]!.items[0]!.sellers = data[5]!.items[0]!.sellers.filter((s) => s.sellerId !== "1");
    expect(parseMetroPage(data, observed).listings.map((l) => l.externalId)).toEqual([
      "5423",
      "39271375",
      "39233661",
    ]);
    expect(parseMetroPage(data, observed).discovered).toBe(6);
  });

  it("rejects invalid money, ambiguous offers, units, multipliers, IDs, taxes and foreign URLs", () => {
    const mutate = (change: (product: ReturnType<typeof sample>) => void) => {
      const product = sample();
      change(product);
      expect(() => parseMetroPage([product], observed)).toThrow(
        /Invalid|Unexpected|Ambiguous|Too small/u,
      );
    };
    mutate((p) => {
      p.items[0]!.itemId = "";
    });
    mutate((p) => {
      p.items[0]!.sellers[0]!.commertialOffer.Price = 12.901;
    });
    mutate((p) => {
      p.items[0]!.sellers[0]!.commertialOffer.ListPrice = 21.501;
    });
    mutate((p) => {
      p.items[0]!.sellers[0]!.commertialOffer.Price = 0;
    });
    mutate((p) => {
      p.items[0]!.sellers[0]!.commertialOffer.Tax = 1;
    });
    mutate((p) => {
      p.items[0]!.measurementUnit = "g";
    });
    mutate((p) => {
      p.items[0]!.unitMultiplier = 2;
    });
    mutate((p) => {
      p.items[0]!.unitMultiplier = 0;
    });
    mutate((p) => {
      p.link = "https://example.com/test/p";
    });
    mutate((p) => {
      p.items[0]!.sellers.push(p.items[0]!.sellers[0]!);
    });
    expect(() => parseMetroPage({ error: "blocked" }, observed)).toThrow(
      /Invalid|Unexpected|Ambiguous|Too small/u,
    );
  });
});

describe("bounded Metro adapter and shared lifecycle", () => {
  it("deduplicates and stops fetching as soon as the usable limit is reached", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([fixture[0], ...fixture], "0-6/860"));
    const result = await createMetroAdapter(request).fetchListings(3);
    expect(result.discovered).toBe(7);
    expect(result.listings).toHaveLength(3);
    expect(new Set(result.listings.map((l) => l.externalId)).size).toBe(3);
    expect(request).toHaveBeenCalledTimes(1);
    const url = requestedUrl(request.mock.calls[0]![0]);
    expect(url.origin).toBe("https://www.metro.pe");
    expect(url.searchParams.get("fq")).toBe("C:/1001436/");
    expect(url.searchParams.get("sc")).toBe("1");
    expect(request.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });

  it("advances actual inclusive offsets past skipped and duplicate products", async () => {
    vi.useFakeTimers();
    try {
      const unavailable = sample();
      unavailable.items[0]!.sellers[0]!.commertialOffer.IsAvailable = false;
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response([unavailable, fixture[1]], "0-1/4"))
        .mockResolvedValueOnce(response([fixture[1], fixture[2]], "2-3/4"));
      const pending = createMetroAdapter(request).fetchListings(2);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.listings.map((l) => l.externalId)).toEqual(["8508", "5423"]);
      expect(result.discovered).toBe(4);
      expect(request).toHaveBeenCalledTimes(2);
      expect(requestedUrl(request.mock.calls[1]![0]).searchParams.get("_from")).toBe("2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns fewer listings at source exhaustion", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(fixture));
    expect((await createMetroAdapter(request).fetchListings(20)).listings).toHaveLength(6);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds duplicate-only traversal to 25 requests and 500 source products", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const from = Number(requestedUrl(input).searchParams.get("_from"));
        return response(
          Array.from({ length: 20 }, () => fixture[0]),
          `${from}-${from + 19}/1000`,
        );
      });
      const pending = createMetroAdapter(request).fetchListings(500);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.discovered).toBe(500);
      expect(result.listings).toHaveLength(1);
      expect(request).toHaveBeenCalledTimes(25);
      expect(requestedUrl(request.mock.calls[24]![0]).searchParams.get("_to")).toBe("499");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops on restrictions, invalid ranges and empty useful results without retries", async () => {
    for (const reply of [
      new Response("blocked", { status: 403 }),
      response(fixture, "1-6/100"),
      response(fixture, "0-19/100"),
      response(fixture, "invalid"),
      response(fixture, "0-5/5"),
      response([{ ...fixture[5], items: [] }], "0-0/1"),
    ]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(reply);
      await expect(createMetroAdapter(request).fetchListings(20)).rejects.toThrow(
        /HTTP 403|pagination|no useful/u,
      );
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects invalid limits before requests", async () => {
    const request = vi.fn<typeof fetch>();
    for (const limit of [0, 501, 1.5, NaN])
      await expect(createMetroAdapter(request).fetchListings(limit)).rejects.toThrow("Limit must");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses generic run lifecycle and persistence counts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(fixture));
    const start = vi.fn<IngestionStore["start"]>().mockResolvedValue("metro-run");
    const persist = vi
      .fn<IngestionStore["persist"]>()
      .mockResolvedValue({ persisted: 3, changed: 3 });
    const finish = vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined);
    expect(await ingest(createMetroAdapter(request), 3, { start, persist, finish })).toEqual({
      id: "metro-run",
      fetched: 6,
      persisted: 3,
      changed: 3,
    });
    expect(start).toHaveBeenCalledWith("metro");
    expect(persist).toHaveBeenCalledWith(
      "metro",
      expect.arrayContaining([
        expect.objectContaining({ externalId: "39233309", currentPriceCents: 2150 }),
      ]),
    );
    expect(finish).toHaveBeenCalledWith("metro-run", {
      status: "success",
      fetched: 6,
      persisted: 3,
      changed: 3,
    });
  });
});

it("preserves validated structured brand metadata for catalog normalization", () => {
  const data = fixture.map((product) => ({ ...product, brand: "GLORIA" }));
  expect(parseMetroPage(data, observed).listings[0]).toMatchObject({
    sourceBrand: "GLORIA",
    sourceUnitMultiplier: 1,
  });
});
