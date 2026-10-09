import { z } from "zod";
import type { KnownListing, NormalizedRetailerListing } from "@comprafino/core";
import { normalizeTottusProduct } from "./tottus-parser.ts";

export type TargetedResult =
  | { status: "observed"; listing: NormalizedRetailerListing }
  | { status: "not-found" | "unavailable" };

export interface TargetedRetailerAdapter {
  lookupListing(this: void, listing: KnownListing): Promise<TargetedResult>;
}

const vtexIdentity = z
  .array(
    z.object({
      productId: z.string(),
      items: z.array(
        z.object({
          itemId: z.string(),
          sellers: z.array(
            z.object({
              sellerId: z.string(),
              commertialOffer: z.object({
                IsAvailable: z.boolean(),
                AvailableQuantity: z.number().int().nonnegative(),
              }),
            }),
          ),
        }),
      ),
    }),
  )
  .max(1);

/** Exact SKU admission precedes the existing full product/price validator. */
export async function lookupVtex(
  fetchPage: typeof fetch,
  endpoint: string,
  known: KnownListing,
  parse: (raw: unknown, at: Date) => { listings: NormalizedRetailerListing[] },
  salesChannel: "1" | "9" = "1",
): Promise<TargetedResult> {
  if (!/^\d+$/u.test(known.externalId)) {
    throw new Error("Invalid SKU");
  }

  const url = new URL(endpoint);
  url.searchParams.set("fq", `skuId:${known.externalId}`);
  url.searchParams.set("sc", salesChannel);
  url.searchParams.set("_from", "0");
  url.searchParams.set("_to", "0");
  const response = await fetchPage(url, requestOptions("application/json"));

  if (response.status === 404) return { status: "not-found" };

  if (!response.ok) {
    throw new Error("Targeted retailer request failed");
  }

  const raw: unknown = await response.json();
  const products = vtexIdentity.parse(raw);

  if (!products.length) return { status: "not-found" };

  if (products[0]!.productId !== known.productId) {
    throw new Error("Product identity changed");
  }

  const matching = products[0]!.items.filter((item) => item.itemId === known.externalId);

  if (!matching.length) return { status: "not-found" };

  if (matching.length !== 1) {
    throw new Error("Ambiguous SKU");
  }

  const sellers = matching[0]!.sellers.filter((seller) => seller.sellerId === "1");

  // Missing or malformed seller evidence is unknown, never verified stock absence.
  if (sellers.length !== 1) {
    throw new Error("Missing or ambiguous availability evidence");
  }

  const offer = sellers[0]!.commertialOffer;

  if (!offer.IsAvailable || offer.AvailableQuantity === 0) return { status: "unavailable" };

  const parsed = parse(raw, new Date());
  const listing = parsed.listings.find((row) => row.externalId === known.externalId);

  if (!listing) {
    throw new Error("Available SKU lacks a usable quote");
  }

  return { status: "observed", listing };
}

function requestOptions(accept: string): RequestInit {
  return {
    headers: { "User-Agent": "CompraFino/0.1 (bounded known listing refresh)", Accept: accept },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  };
}

const productPage = z.object({
  props: z.object({
    pageProps: z.object({
      productData: z.object({
        id: z.string(),
        brandName: z.string(),
        merchantCategoryId: z.string().optional(),
        isPublished: z.boolean(),
        variants: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            isPurchaseable: z.boolean().optional(),
            isOnlineSellable: z.boolean().optional(),
            offerings: z.array(z.object({ sellerId: z.string(), isActive: z.boolean() })),
            prices: z.array(z.unknown()),
            medias: z.array(z.object({ url: z.url() })),
            attributes: z.object({
              measurement: z.object({
                formato: z.string().optional(),
                "unidad-de-medida": z.enum(["KG", "UN"]),
              }),
            }),
          }),
        ),
      }),
    }),
  }),
});

export function parseTottusProduct(html: string, known: KnownListing, at: Date): TargetedResult {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/u.exec(html);

  if (!script) {
    throw new Error("Product hydration missing");
  }

  const raw: unknown = JSON.parse(script[1]!);
  const product = productPage.parse(raw).props.pageProps.productData;

  if (product.id !== known.productId) {
    throw new Error("Product identity changed");
  }

  const variants = product.variants.filter((v) => v.id === known.externalId);

  if (!variants.length) return { status: "not-found" };

  if (variants.length !== 1) {
    throw new Error("Ambiguous SKU");
  }

  const variant = variants[0]!;
  const sellers = variant.offerings.filter((o) => o.sellerId === "TOTTUS_PERU");

  if (sellers.length > 1) {
    throw new Error("Ambiguous seller");
  }

  if (
    !product.isPublished ||
    variant.isPurchaseable === false ||
    variant.isOnlineSellable === false ||
    sellers[0]?.isActive === false
  ) {
    return { status: "unavailable" };
  }

  if (!sellers[0]) {
    throw new Error("Missing availability seller evidence");
  }

  // Reuse category/search price, unit and listing validation exactly.
  const mapped = {
    productId: product.id,
    skuId: variant.id,
    displayName: variant.name,
    brand: product.brandName,
    sellerId: "TOTTUS_PERU",
    url: known.url,
    mediaUrls: variant.medias.map((m) => m.url),
    measurements: {
      format: variant.attributes.measurement.formato,
      unit: variant.attributes.measurement["unidad-de-medida"],
    },
    merchantCategoryId: product.merchantCategoryId,
    prices: variant.prices,
  };
  // Omitted purchase flags are unknown stock, never positive or negative evidence.
  const available =
    variant.isPurchaseable === true && variant.isOnlineSellable === true ? true : undefined;
  const listing = { ...normalizeTottusProduct(mapped, at), available };

  return { status: "observed", listing };
}

export async function lookupTottus(
  fetchPage: typeof fetch,
  known: KnownListing,
): Promise<TargetedResult> {
  const url = new URL(known.url);

  if (
    url.origin !== "https://www.tottus.com.pe" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(`/tottus-pe/articulo/${known.productId}/`)
  ) {
    throw new Error("Untrusted product URL");
  }

  url.search = "";
  url.hash = "";
  const response = await fetchPage(url, requestOptions("text/html"));

  if (response.status === 404 || response.status === 410) return { status: "not-found" };

  if (!response.ok) {
    throw new Error("Targeted retailer request failed");
  }

  return parseTottusProduct(await response.text(), known, new Date());
}
