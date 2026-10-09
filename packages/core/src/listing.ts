import { conditionalOfferSchema } from "./conditional-offer.ts";
import { z } from "zod";

export const retailerIdSchema = z.enum(["tottus", "plaza-vea", "metro", "makro"]);

export type RetailerId = z.infer<typeof retailerIdSchema>;

const cents = z.number().int().min(0).max(2_147_483_647);

export const listingSchema = z.object({
  retailer: retailerIdSchema,
  externalId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  url: z.url({ protocol: /^https$/ }),
  imageUrl: z.url({ protocol: /^https$/ }).optional(),
  currentPriceCents: cents.refine((value) => value > 0, "Ordinary payable price must be positive"),
  regularPriceCents: cents.optional(),
  currency: z.literal("PEN"),
  priceUnit: z.enum(["KG", "UN"]),
  available: z.boolean().optional(),
  sourceBrand: z.string().trim().min(1).optional(),
  sourceUnitMultiplier: z.number().positive().finite().optional(),
  packageText: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  observedAt: z.date(),
  conditionalOffers: z.array(conditionalOfferSchema).max(1).optional(),
});

export type NormalizedRetailerListing = z.infer<typeof listingSchema>;

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Parse a decimal PEN amount exactly, without floating-point multiplication. */
export function parsePenCents(value: string | number): number {
  const text = String(value)
    .trim()
    .replace(/^S\/\s*/u, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(text);

  if (!match) {
    throw new Error("Invalid PEN decimal amount");
  }

  const result = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));

  if (result > 2_147_483_647n) {
    throw new Error("PEN amount exceeds database integer range");
  }

  return Number(result);
}

export type PriceState = {
  currentPriceCents: number;
  regularPriceCents?: number | null;
  currency: "PEN";
  priceUnit: "KG" | "UN";
};

export function priceStateChanged(previous: PriceState | undefined, next: PriceState): boolean {
  return (
    !previous ||
    previous.currentPriceCents !== next.currentPriceCents ||
    (previous.regularPriceCents ?? null) !== (next.regularPriceCents ?? null) ||
    previous.currency !== next.currency ||
    previous.priceUnit !== next.priceUnit
  );
}
