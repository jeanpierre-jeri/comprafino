import { expect, it, vi } from "vitest";
import type { KnownListing } from "@comprafino/core";
import { createMetroAdapter } from "./metro.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createTottusAdapter } from "./tottus.ts";
import { parseTottusProduct } from "./targeted.ts";
import metro from "./fixtures/metro.json";
import plaza from "./fixtures/plaza-vea.json";
import tottus from "./fixtures/tottus-product.json";

function known(
  externalId: string,
  productId: string,
  retailer: KnownListing["retailer"] = "metro",
): KnownListing {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    retailer,
    externalId,
    productId,
    url: `https://www.tottus.com.pe/tottus-pe/articulo/${productId}/product`,
    observedAt: new Date("2026-10-03T09:00:00Z"),
    public: true,
    firstSeenVia: "unknown",
    lastCategoryObservedAt: null,
    lastTargetedAttemptAt: null,
  };
}

it.each([
  ["metro", metro, createMetroAdapter],
  ["plaza-vea", plaza, createPlazaVeaAdapter],
] as const)(
  "maps exact %s SKU with existing price semantics in one request",
  async (retailer, fixture, factory) => {
    const product = fixture[0]!;
    const item = product.items[0]!;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([product], { status: 206 }));
    const result = await factory(fetcher).lookupListing(
      known(item.itemId, product.productId, retailer),
    );
    expect(result.status).toBe("observed");
    expect(result).toMatchObject({
      status: "observed",
      listing: { retailer, externalId: item.itemId, available: true },
    });
    const input = fetcher.mock.calls[0]![0];

    if (!(input instanceof URL)) {
      throw new Error("Expected URL request");
    }

    const url = input;
    expect(url.searchParams.get("fq")).toBe(`skuId:${item.itemId}`);
    expect(url.searchParams.get("_to")).toBe("0");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it("distinguishes VTEX empty/404, unavailable seller and malformed/system errors", async () => {
  const product = structuredClone(metro[0]!);
  const item = product.items[0]!;
  const row = known(item.itemId, product.productId);

  for (const response of [Response.json([]), new Response(null, { status: 404 })]) {
    expect(await createMetroAdapter(async () => response).lookupListing(row)).toEqual({
      status: "not-found",
    });
  }

  for (const seller of item.sellers) {
    if (seller.sellerId === "1") {
      seller.commertialOffer.IsAvailable = false;
      seller.commertialOffer.Price = 0;
    }
  }

  expect(await createMetroAdapter(async () => Response.json([product])).lookupListing(row)).toEqual(
    { status: "unavailable" },
  );

  for (const response of [
    Response.json({ bad: true }),
    new Response(null, { status: 429 }),
    new Response(null, { status: 503 }),
  ]) {
    await expect(createMetroAdapter(async () => response).lookupListing(row)).rejects.toThrow(/./u);
  }

  await expect(
    createMetroAdapter(async () => Response.json(metro.slice(0, 1))).lookupListing({
      ...row,
      productId: "99999",
    }),
  ).rejects.toThrow("identity");
});

const product = tottus.props.pageProps.productData;

const tottusKnown = known(product.variants[0]!.id, product.id, "tottus");

const html = (value: unknown) => `<script id="__NEXT_DATA__">${JSON.stringify(value)}</script>`;

it("maps Tottus exact variant using ordinary internet/reference price and quote unit", async () => {
  const at = new Date("2026-10-04T12:00:00Z");
  expect(parseTottusProduct(html(tottus), tottusKnown, at)).toMatchObject({
    status: "observed",
    listing: {
      externalId: tottusKnown.externalId,
      productId: product.id,
      currentPriceCents: 970,
      regularPriceCents: 1100,
      imageUrl: product.variants[0]!.medias[0]!.url,
      priceUnit: "UN",
      observedAt: at,
    },
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(html(tottus)));
  expect((await createTottusAdapter(fetcher).lookupListing(tottusKnown)).status).toBe("observed");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("Tottus unavailable does not fabricate prices and missing exact variants are not found", () => {
  const unavailable = structuredClone(tottus);
  unavailable.props.pageProps.productData.variants[0]!.isPurchaseable = false;
  expect(parseTottusProduct(html(unavailable), tottusKnown, new Date())).toEqual({
    status: "unavailable",
  });
  expect(
    parseTottusProduct(html(tottus), { ...tottusKnown, externalId: "99999" }, new Date()),
  ).toEqual({ status: "not-found" });
  expect(() =>
    parseTottusProduct(html(tottus), { ...tottusKnown, productId: "99999" }, new Date()),
  ).toThrow("identity");
  expect(() => parseTottusProduct("blocked", tottusKnown, new Date())).toThrow(/./u);
});

it("rejects untrusted Tottus URL before a request and does not retry system failures", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
  await expect(
    createTottusAdapter(fetcher).lookupListing({ ...tottusKnown, url: "https://evil.test/p" }),
  ).rejects.toThrow(/./u);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(createTottusAdapter(fetcher).lookupListing(tottusKnown)).rejects.toThrow(/./u);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(
    await createTottusAdapter(async () => new Response(null, { status: 404 })).lookupListing(
      tottusKnown,
    ),
  ).toEqual({ status: "not-found" });
});

it.each([
  ["metro", metro, createMetroAdapter],
  ["plaza-vea", plaza, createPlazaVeaAdapter],
] as const)(
  "%s distinguishes missing seller evidence from explicit unavailable stock",
  async (retailer, fixture, factory) => {
    const original = fixture[0]!;
    const item = original.items[0]!;
    const row = known(item.itemId, original.productId, retailer);
    const missing = structuredClone(original);
    missing.items[0]!.sellers = [];
    await expect(factory(async () => Response.json([missing])).lookupListing(row)).rejects.toThrow(
      "availability evidence",
    );
    const zero = structuredClone(original);
    zero.items[0]!.sellers.find((s) => s.sellerId === "1")!.commertialOffer.AvailableQuantity = 0;
    expect(await factory(async () => Response.json([zero])).lookupListing(row)).toEqual({
      status: "unavailable",
    });
    const invalid = structuredClone(original);
    const seller = invalid.items[0]!.sellers.find((s) => s.sellerId === "1")!;
    seller.commertialOffer.IsAvailable = true;
    seller.commertialOffer.AvailableQuantity = 1;
    seller.commertialOffer.Price = 0;
    await expect(factory(async () => Response.json([invalid])).lookupListing(row)).rejects.toThrow(
      /./u,
    );
  },
);

it("Tottus exact positive flags verify availability; missing seller is unknown", () => {
  expect(parseTottusProduct(html(tottus), tottusKnown, new Date())).toMatchObject({
    status: "observed",
    listing: { available: true },
  });
  const missing = structuredClone(tottus);
  missing.props.pageProps.productData.variants[0]!.offerings = [];
  expect(() => parseTottusProduct(html(missing), tottusKnown, new Date())).toThrow(
    "Missing availability",
  );
});

it.each(["isPurchaseable", "isOnlineSellable", "both"] as const)(
  "Tottus omitted %s flags preserve a valid ordinary quote with unknown availability",
  (missing) => {
    const fixture = structuredClone(tottus);
    const variant = fixture.props.pageProps.productData.variants[0]!;
    const { isPurchaseable, isOnlineSellable, ...withoutFlags } = variant;
    const optionalFlags = {
      ...withoutFlags,
      ...(missing === "isOnlineSellable" ? { isPurchaseable } : {}),
      ...(missing === "isPurchaseable" ? { isOnlineSellable } : {}),
    };
    const page = {
      props: {
        pageProps: {
          productData: { ...fixture.props.pageProps.productData, variants: [optionalFlags] },
        },
      },
    };
    expect(parseTottusProduct(html(page), tottusKnown, new Date())).toMatchObject({
      status: "observed",
      listing: { available: undefined, currentPriceCents: 970, priceUnit: "UN" },
    });
    expect(
      parseTottusProduct(
        html({
          props: {
            pageProps: {
              productData: {
                ...page.props.pageProps.productData,
                variants: [{ ...optionalFlags, isPurchaseable: false }],
              },
            },
          },
        }),
        tottusKnown,
        new Date(),
      ),
    ).toEqual({ status: "unavailable" });
    expect(() =>
      parseTottusProduct(
        html({
          props: {
            pageProps: {
              productData: {
                ...page.props.pageProps.productData,
                variants: [{ ...optionalFlags, isOnlineSellable: "true" }],
              },
            },
          },
        }),
        tottusKnown,
        new Date(),
      ),
    ).toThrow(/isOnlineSellable/u);
  },
);
