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
