import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/tottus.json";
import { createTottusAdapter, parseTottusPage } from "./tottus.ts";
const observed = new Date("2026-10-03T14:00:00Z");
const html = (data: unknown) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
describe("sanitized live Tottus hydration fixture", () => {
  it("keeps SKU identity, internet rather than card price, reference price and weighted unit", () => {
    const { listings } = parseTottusPage(html(fixture), observed);
    expect(listings[1]).toMatchObject({
      externalId: "115844222",
      productId: "115844221",
      currentPriceCents: 1450,
      regularPriceCents: 1690,
      priceUnit: "KG",
      packageText: "Empaque 1Kg Aprox",
      observedAt: observed,
    });
    expect(listings[2]).toMatchObject({ currentPriceCents: 1290, priceUnit: "UN" });
    expect(listings[2]?.regularPriceCents).toBeUndefined();
    expect(listings.every((listing) => listing.available === undefined)).toBe(true);
    expect(listings[4]?.packageText).toBe("Pack 3 Cajas 946 mL");
  });
  it.each(["16.90", "14.50", "14.00", "0", undefined])(
    "preserves only a normal price above the ordinary price: %s",
    (normalPrice) => {
      const data = structuredClone(fixture);
      const product = data.props.pageProps.results[1]!;
      product.prices = product.prices.filter((price) => price.type !== "normalPrice");
      if (normalPrice !== undefined)
        product.prices.push({
          ...product.prices[0]!,
          type: "normalPrice",
          symbol: "S/",
          crossed: true,
          price: [normalPrice],
        });
      const listing = parseTottusPage(html(data), observed).listings[1];
      expect(listing?.currentPriceCents).toBe(1450);
      expect(listing?.regularPriceCents).toBe(normalPrice === "16.90" ? 1690 : undefined);
    },
  );
  it("handles missing optional metadata and trims source noise", () => {
    const data = structuredClone(fixture);
    const product = data.props.pageProps.results[0]!;
    const { mediaUrls: _images, merchantCategoryId: _category, ...withoutOptional } = product;
    const result = parseTottusPage(
      html({
        props: {
          pageProps: {
            ...data.props.pageProps,
            results: [
              {
                ...withoutOptional,
                displayName: "  Chorizo\n San Fernando  ",
                measurements: { unit: "UN" },
                url: `${product.url}?tracking=1#x`,
              },
            ],
          },
        },
      }),
      observed,
    );
    expect(result.listings[0]).toMatchObject({ title: "Chorizo San Fernando", url: product.url });
    expect(result.listings[0]?.imageUrl).toBeUndefined();
    expect(result.listings[0]?.packageText).toBeUndefined();
  });
  it("fails closed on missing JSON, malformed decimals, currency and card-only offers", () => {
    expect(() => parseTottusPage("<html>Access denied</html>", observed)).toThrow(
      "public listing JSON is missing",
    );
    for (const change of [{ symbol: "$" }, { price: ["12.901"] }, { type: "cmrPrice" }]) {
      const data = structuredClone(fixture);
      Object.assign(data.props.pageProps.results[0]!.prices[0]!, change);
      expect(() => parseTottusPage(html(data), observed)).toThrow(/currency|decimal|Ambiguous/u);
    }
  });
  it("deduplicates sponsored listings and honors limits without requiring a database", async () => {
    const data = structuredClone(fixture);
    data.props.pageProps.results.unshift(data.props.pageProps.results[0]!);
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(html(data)));
    const result = await createTottusAdapter(request).fetchListings(3);
    expect(result.listings).toHaveLength(3);
    expect(new Set(result.listings.map((listing) => listing.externalId)).size).toBe(3);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("stops on restrictions without retries", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("blocked", { status: 403 }));
    await expect(createTottusAdapter(request).fetchListings(20)).rejects.toThrow("HTTP 403");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

it("preserves validated structured brand metadata for catalog normalization", () => {
  const data = {
    ...fixture,
    props: {
      ...fixture.props,
      pageProps: {
        ...fixture.props.pageProps,
        results: fixture.props.pageProps.results.map((product) => ({
          ...product,
          brand: "TOTTUS",
        })),
      },
    },
  };
  expect(parseTottusPage(html(data), observed).listings[0]?.sourceBrand).toBe("TOTTUS");
});

it("selects the observed dairy category while retaining the existing parser and request bounds", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(html(fixture)));
  await createTottusAdapter(request, "dairy").fetchListings(2);
  expect(request.mock.calls[0]![0]).toEqual(
    new URL("https://www.tottus.com.pe/tottus-pe/lista/CATG16061/Lacteos?page=1"),
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("skips observed dairy rows without a quote unit, preserving ordinary prices and source counts", async () => {
  const dairy = (await import("./fixtures/tottus-dairy.json")).default;
  const result = parseTottusPage(html(dairy), observed);
  expect(result.discovered).toBe(6);
  expect(result.skippedMissingPriceUnit).toBe(1);
  expect(result.listings).toHaveLength(5);
  expect(result.listings.every((row) => row.priceUnit === "UN")).toBe(true);
  expect(result.listings.some((row) => row.title.includes("Edam"))).toBe(false);
  expect(result.listings[0]!.currentPriceCents).toBe(2190);
  expect(result.listings[0]!.regularPriceCents).toBe(2460);
  const unsupported = structuredClone(dairy);
  unsupported.props.pageProps.results[0]!.measurements.unit = "L";
  expect(() => parseTottusPage(html(unsupported), observed)).toThrow(/KG|UN/u);
});

it("rejects a zero ordinary Tottus quote", () => {
  const data = structuredClone(fixture);
  const product = data.props.pageProps.results[0]!;
  product.prices.find((price) => price.type === "internetPrice")!.price = ["0"];
  expect(() => parseTottusPage(html(data), observed)).toThrow(
    "Ordinary payable price must be positive",
  );
});
