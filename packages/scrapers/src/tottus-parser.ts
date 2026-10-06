import { z } from "zod";
import { listingSchema, normalizeWhitespace, parsePenCents } from "@comprafino/core";

const sourcePrice = z.object({
  type: z.string(),
  symbol: z.string(),
  icons: z.string().optional(),
  crossed: z.boolean(),
  price: z.array(z.union([z.string(), z.number()])).length(1),
});

const sourceProduct = z.object({
  brand: z.string().trim().min(1).optional(),
  productId: z.string().regex(/^\d+$/u),
  skuId: z.string().regex(/^\d+$/u),
  displayName: z.string().min(1),
  url: z.url(),
  sellerId: z.literal("TOTTUS_PERU"),
  mediaUrls: z.array(z.url()).optional(),
  measurements: z.object({ format: z.string().optional(), unit: z.enum(["KG", "UN"]).optional() }),
  merchantCategoryId: z.string().optional(),
  prices: z.preprocess(
    (raw) =>
      Array.isArray(raw)
        ? raw.filter((value: unknown) => {
            const type = z.object({ type: z.string() }).safeParse(value);

            return type.success && type.data.type === "cmrPrice"
              ? sourcePrice.safeParse(value).success
              : true;
          })
        : raw,
    z.array(sourcePrice),
  ),
});

const sourcePage = z.object({
  props: z.object({
    pageProps: z.object({
      results: z.array(sourceProduct),
      pagination: z.object({
        count: z.number().int().nonnegative(),
        perPage: z.number().int().positive(),
        currentPage: z.number().int().positive(),
      }),
    }),
  }),
});

/** Read only the site's explicit hydration JSON; no general HTML parser required. */
export function parseTottusPage(html: string, observedAt: Date) {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/u.exec(html);

  if (!script) {
    throw new Error("Tottus public listing JSON is missing; stop and inspect the source");
  }

  const raw: unknown = JSON.parse(script[1]!);
  const page = sourcePage.parse(raw).props.pageProps;
  // An omitted quote unit cannot safely become a package or per-KG price.
  // Skip that source row; explicit unsupported units still fail schema validation.
  const eligible = page.results.filter((product) => product.measurements.unit !== undefined);
  const listings = eligible.map((product) => normalizeTottusProduct(product, observedAt));

  return {
    listings,
    pagination: page.pagination,
    discovered: page.results.length,
    skippedMissingPriceUnit: page.results.length - eligible.length,
  };
}

/** Shared price/unit mapping for category, search and an exact PDP variant. */
export function normalizeTottusProduct(input: unknown, observedAt: Date) {
  const product = sourceProduct.parse(input);

  if (!product.measurements.unit) {
    throw new Error("Missing Tottus quote unit");
  }

  const current = product.prices.filter(
    (price) => price.type === "internetPrice" && !price.crossed,
  );
  const regular = product.prices.filter((price) => price.type === "normalPrice");

  if (current.length !== 1 || regular.length > 1) {
    throw new Error("Ambiguous or missing Tottus internet/regular price");
  }

  for (const price of [...current, ...regular]) {
    if (price.symbol.trim() !== "S/") {
      throw new Error("Unexpected Tottus currency");
    }
  }

  const url = new URL(product.url);

  if (
    url.origin !== "https://www.tottus.com.pe" ||
    !url.pathname.startsWith(`/tottus-pe/articulo/${product.productId}/`)
  ) {
    throw new Error("Unexpected Tottus product URL");
  }

  url.search = "";
  url.hash = "";
  const currentPriceCents = parsePenCents(current[0]!.price[0]!);
  const normalPriceCents = regular[0] ? parsePenCents(regular[0].price[0]!) : undefined;
  const cmr = product.prices.filter((price) => price.type === "cmrPrice");
  const conditionalOffers = [];

  if (
    cmr.length === 1 &&
    !cmr[0]!.crossed &&
    cmr[0]!.icons === "cmr-icon" &&
    cmr[0]!.symbol.trim() === "S/"
  ) {
    try {
      const priceCents = parsePenCents(cmr[0]!.price[0]!);

      if (priceCents > 0 && priceCents < currentPriceCents) {
        conditionalOffers.push({
          conditionType: "payment_card",
          programKey: "cmr",
          conditionLabel: "Requiere tarjeta CMR",
          priceCents,
          observedAt,
        });
      }
    } catch {
      /* An invalid benefit never replaces or discards a valid ordinary price. */
    }
  }

  return listingSchema.parse({
    conditionalOffers,
    retailer: "tottus",
    externalId: product.skuId,
    productId: product.productId,
    title: normalizeWhitespace(product.displayName),
    url: url.href,
    imageUrl: product.mediaUrls?.[0],
    currentPriceCents,
    regularPriceCents:
      normalPriceCents !== undefined && normalPriceCents > currentPriceCents
        ? normalPriceCents
        : undefined,
    currency: "PEN",
    priceUnit: product.measurements.unit,
    packageText: product.measurements.format
      ? normalizeWhitespace(product.measurements.format) || undefined
      : undefined,
    sourceBrand: product.brand,
    category: product.merchantCategoryId || undefined,
    observedAt,
  });
}
