import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/plaza-vea.json";
import { createPlazaVeaAdapter, parsePlazaVeaPage } from "./plaza-vea.ts";
import { ingest } from "./ingestion.ts";
import type { IngestionStore } from "./ingestion.ts";

const observed = new Date("2026-10-03T15:00:00Z");
const requestedUrl = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? new URL(input.url) : new URL(input);
const response = (data: unknown, range = "0-5/6") =>
  new Response(JSON.stringify(data), { status: 206, headers: { resources: range } });

describe("sanitized live Plaza Vea public catalog fixture", () => {
  it("normalizes SKU identity, normal/discounted offers, images, category and multipacks", () => {
    const { listings, discovered } = parsePlazaVeaPage(fixture, observed);
    expect(discovered).toBe(6);
    expect(listings[0]).toMatchObject({
      retailer: "plaza-vea",
      externalId: "11370895",
      productId: "101001962",
      title: "Leche UHT GLORIA Zero Lacto Caja 946ml",
      currentPriceCents: 620,
      currency: "PEN",
      priceUnit: "UN",
      available: true,
      packageText: "Caja 946ml",
      category: "853",
      observedAt: observed,
      url: fixture[0]!.link,
      imageUrl: fixture[0]!.items[0]!.images[0]!.imageUrl,
    });
    expect(listings[0]?.regularPriceCents).toBeUndefined();
    // Card teaser offers 4.10 off: it must never replace the ordinary 21.50.
    expect(listings[1]).toMatchObject({
      currentPriceCents: 2150,
      regularPriceCents: 2460,
      packageText: "Paquete 6un",
    });
    expect(listings[2]).toMatchObject({ currentPriceCents: 1590, regularPriceCents: 1790 });
    expect(listings[3]?.packageText).toBe("Paquete 3un");
  });

  it.each([
    { listPrice: 7.9, reference: 790 },
    { listPrice: 6.2, reference: undefined },
    { listPrice: 5.9, reference: undefined },
    { listPrice: 0, reference: undefined },
    { listPrice: undefined, reference: undefined },
  ])(
    "preserves only a reference price above current price: $listPrice",
    ({ listPrice, reference }) => {
      const data = structuredClone(fixture[0]!);
      const item = data.items[0]!;
      const offer = item.sellers[0]!.commertialOffer;
      const result = parsePlazaVeaPage(
        [
          {
            ...data,
            items: [
              {
                ...item,
                sellers: [{ sellerId: "1", commertialOffer: { ...offer, ListPrice: listPrice } }],
              },
            ],
          },
        ],
        observed,
      );
      expect(result.listings[0]?.currentPriceCents).toBe(620);
      expect(result.listings[0]?.regularPriceCents).toBe(reference);
    },
  );

  it("keeps weighted quotes per kg rather than multiplying them into package totals", () => {
    expect(parsePlazaVeaPage(fixture, observed).listings[5]).toMatchObject({
      externalId: "9357",
      currentPriceCents: 670,
      regularPriceCents: 890,
      priceUnit: "KG",
      packageText: "unitMultiplier: 2.2 kg",
    });
  });

  it("retains separate priced SKU variants under one parent product and URL", () => {
    const data = structuredClone(fixture[0]!);
    const variant = structuredClone(data.items[0]!);
    variant.itemId = "999999";
    variant.name = "Second SKU variant";
    variant.sellers[0]!.commertialOffer.Price = 5.9;
    data.items.push(variant);
    const result = parsePlazaVeaPage([data], observed);
    expect(result.discovered).toBe(1);
    expect(
      result.listings.map((listing) => ({
        id: listing.externalId,
        title: listing.title,
        price: listing.currentPriceCents,
        productId: listing.productId,
        url: listing.url,
      })),
    ).toEqual([
      {
        id: "11370895",
        title: data.items[0]!.name,
        price: 620,
        productId: data.productId,
        url: data.link,
      },
      {
        id: "999999",
        title: "Second SKU variant",
        price: 590,
        productId: data.productId,
        url: data.link,
      },
    ]);
  });

  it("handles optional metadata, exact decimals, relative URLs and SKU-specific titles", () => {
    const p = fixture[0]!;
    const item = p.items[0]!;
    const offer = item.sellers[0]!.commertialOffer;
    const result = parsePlazaVeaPage(
      [
        {
          ...p,
          link: `${new URL(p.link).pathname}?tracking=1#fragment`,
          categoryId: undefined,
          "Presentación unitarios vitrina": undefined,
          items: [
            {
              ...item,
              name: "  Leche\n GLORIA  ",
              images: undefined,
              sellers: [
                { sellerId: "1", commertialOffer: { ...offer, Price: 0.29, ListPrice: undefined } },
              ],
            },
          ],
        },
      ],
      observed,
    );
    expect(result.listings[0]).toMatchObject({
      title: "Leche GLORIA",
      currentPriceCents: 29,
      url: p.link,
    });
    for (const key of ["imageUrl", "regularPriceCents", "packageText", "category"] as const)
      expect(result.listings[0]?.[key]).toBeUndefined();
    // A real captured listing has no presentation field.
    expect(parsePlazaVeaPage(fixture, observed).listings[4]?.packageText).toBeUndefined();
  });

  it("skips unavailable placeholders and marketplace-only offers, counting source products", () => {
    // Synthetic mutations: no unavailable item was captured in the bounded sample.
    const data = structuredClone(fixture);
    Object.assign(data[0]!.items[0]!.sellers[0]!.commertialOffer, {
      IsAvailable: false,
      Price: 0,
      AvailableQuantity: 0,
    });
    data[1]!.items[0]!.sellers[0]!.sellerId = "marketplace";
    data[2]!.items[0]!.sellers[0]!.commertialOffer.AvailableQuantity = 0;
    const result = parsePlazaVeaPage(data, observed);
    expect(result.discovered).toBe(6);
    expect(result.listings.map((listing) => listing.externalId)).toEqual([
      "11390026",
      "42082",
      "9357",
    ]);
  });

  it("selects Plaza Vea seller 1 even when another seller precedes it", () => {
    const data = structuredClone(fixture);
    const other = structuredClone(data[0]!.items[0]!.sellers[0]!);
    other.sellerId = "marketplace";
    other.commertialOffer.Price = 1;
    data[0]!.items[0]!.sellers.unshift(other);
    expect(parsePlazaVeaPage(data, observed).listings[0]?.currentPriceCents).toBe(620);
  });

  it("rejects ambiguous sellers, missing IDs, invalid amounts, units, taxes and foreign URLs", () => {
    const mutate = (change: (data: typeof fixture) => void) => {
      const data = structuredClone(fixture);
      change(data);
      expect(() => parsePlazaVeaPage(data, observed)).toThrow(/Invalid|Unexpected|Ambiguous/u);
    };
    mutate((d) => {
      d[0]!.items[0]!.itemId = "";
    });
    mutate((d) => {
      d[0]!.items[0]!.sellers[0]!.commertialOffer.Price = 12.901;
    });
    mutate((d) => {
      d[0]!.items[0]!.sellers[0]!.commertialOffer.Price = 0;
    });
    mutate((d) => {
      d[0]!.items[0]!.sellers[0]!.commertialOffer.ListPrice = 6.201;
    });
    mutate((d) => {
      d[0]!.items[0]!.sellers[0]!.commertialOffer.Tax = 1;
    });
    mutate((d) => {
      d[0]!.items[0]!.measurementUnit = "g";
    });
    mutate((d) => {
      d[0]!.items[0]!.unitMultiplier = 2;
    });
    mutate((d) => {
      d[0]!.link = "https://example.com/test/p";
    });
    mutate((d) => {
      d[0]!.items[0]!.sellers.push(d[0]!.items[0]!.sellers[0]!);
    });
    expect(() => parsePlazaVeaPage({ error: "blocked" }, observed)).toThrow(/Invalid/u);
  });
});

describe("bounded Plaza Vea adapter and generic ingestion", () => {
  it("deduplicates SKUs, honors normalized limits and avoids extra requests", async () => {
    const data = [fixture[0], fixture[0], ...fixture.slice(1)];
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(data, "0-6/100"));
    const result = await createPlazaVeaAdapter(request).fetchListings(3);
    expect(result.listings).toHaveLength(3);
    expect(new Set(result.listings.map((l) => l.externalId)).size).toBe(3);
    expect(result.discovered).toBe(7);
    expect(request).toHaveBeenCalledTimes(1);
    const url = requestedUrl(request.mock.calls[0]![0]);
    expect(url.searchParams.get("fq")).toBe("C:/845/");
    expect(url.searchParams.get("sc")).toBe("1");
  });

  it("advances inclusive product offsets past skipped/duplicate rows to usable listings", async () => {
    const unavailable = structuredClone(fixture[0]!);
    unavailable.items[0]!.sellers[0]!.commertialOffer.IsAvailable = false;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([unavailable, fixture[1]], "0-1/4"))
      .mockResolvedValueOnce(response([fixture[1], fixture[2]], "2-3/4"));
    const result = await createPlazaVeaAdapter(request).fetchListings(2);
    expect(result.listings.map((l) => l.externalId)).toEqual(["11359692", "10936209"]);
    expect(result.discovered).toBe(4);
    expect(request).toHaveBeenCalledTimes(2);
    expect(requestedUrl(request.mock.calls[1]![0]).searchParams.get("_from")).toBe("2");
  });

  it("stops at source exhaustion with fewer usable listings", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(fixture));
    expect((await createPlazaVeaAdapter(request).fetchListings(20)).listings).toHaveLength(6);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("caps duplicate-only source coverage at 500 products and 25 requests", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const from = Number(requestedUrl(input).searchParams.get("_from"));
        return response(
          Array.from({ length: 20 }, () => fixture[0]),
          `${from}-${from + 19}/1000`,
        );
      });
      const pending = createPlazaVeaAdapter(request).fetchListings(500);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.listings).toHaveLength(1);
      expect(result.discovered).toBe(500);
      expect(request).toHaveBeenCalledTimes(25);
      expect(requestedUrl(request.mock.calls[24]![0]).searchParams.get("_to")).toBe("499");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops on restrictions and invalid pagination without retries", async () => {
    for (const reply of [
      new Response("blocked", { status: 403 }),
      response(fixture, "1-6/100"),
      response(fixture, "0-19/100"),
      response(fixture, "invalid"),
    ]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(reply);
      await expect(createPlazaVeaAdapter(request).fetchListings(20)).rejects.toThrow(
        /HTTP 403|pagination/u,
      );
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("validates bounds before fetching", async () => {
    const request = vi.fn<typeof fetch>();
    for (const limit of [0, 501, 1.5, NaN])
      await expect(createPlazaVeaAdapter(request).fetchListings(limit)).rejects.toThrow(
        "Limit must",
      );
    expect(request).not.toHaveBeenCalled();
  });

  it("passes normalized Plaza Vea listings through the existing store lifecycle", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(fixture));
    const persist = vi
      .fn<IngestionStore["persist"]>()
      .mockResolvedValue({ persisted: 3, changed: 3 });
    const finish = vi.fn<IngestionStore["finish"]>().mockResolvedValue(undefined);
    const start = vi.fn<IngestionStore["start"]>().mockResolvedValue("pv-run");
    expect(await ingest(createPlazaVeaAdapter(request), 3, { start, persist, finish })).toEqual({
      id: "pv-run",
      fetched: 6,
      persisted: 3,
      changed: 3,
    });
    expect(start).toHaveBeenCalledWith("plaza-vea");
    expect(persist).toHaveBeenCalledWith(
      "plaza-vea",
      expect.arrayContaining([
        expect.objectContaining({ externalId: "11359692", currentPriceCents: 2150 }),
      ]),
    );
    expect(finish).toHaveBeenCalledWith("pv-run", {
      status: "success",
      fetched: 6,
      persisted: 3,
      changed: 3,
    });
  });
});
