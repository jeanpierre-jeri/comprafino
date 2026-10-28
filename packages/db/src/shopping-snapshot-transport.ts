import { z } from "zod";

// Positional transport inside the single SQL snapshot only. Every value is
// restored before the existing domain schemas run; no field is defaulted/dropped.
// Offer order matches genericOfferProjection. Integration tests compare every
// reconstructed row against the previous object projection, including history.
const fields = {
  offer: [
    "listing",
    "sourceCategory",
    "retailerName",
    "url",
    "imageUrl",
    "currentPriceCents",
    "regularPriceCents",
    "conditionalOffers",
    "observedAt",
    "available",
    "fingerprint",
    "version",
    "canonicalId",
    "retailerCount",
  ],
  history: ["listingId", "date", "priceCents", "observedAt"],
  weekday: ["listingId", "date", "priceCents"],
} as const;

type SnapshotRow = keyof typeof fields;

const rowsSchema = z.array(z.unknown());
const rowSchemas = {
  offer: rowsSchema.length(fields.offer.length),
  history: rowsSchema.length(fields.history.length),
  weekday: rowsSchema.length(fields.weekday.length),
};

export function shoppingSnapshotRow(kind: SnapshotRow, raw: unknown) {
  const names = fields[kind];
  const values = rowSchemas[kind].parse(raw);
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

export function shoppingSnapshotRows(kind: SnapshotRow, raw: unknown) {
  return rowsSchema.parse(raw).map((row) => shoppingSnapshotRow(kind, row));
}
