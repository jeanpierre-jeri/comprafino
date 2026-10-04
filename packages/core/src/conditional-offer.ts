import { z } from "zod";
/** Only concrete, observed payable amounts; no teaser discount arithmetic. */
export const conditionalOfferSchema = z
  .object({
    conditionType: z.literal("payment_card"),
    programKey: z.literal("cmr"),
    conditionLabel: z.literal("Requiere tarjeta CMR"),
    priceCents: z.number().int().positive().max(2_147_483_647),
    observedAt: z.coerce.date(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .refine((offer) => !offer.startsAt || !offer.endsAt || offer.startsAt < offer.endsAt);
export type ConditionalOffer = z.infer<typeof conditionalOfferSchema>;
