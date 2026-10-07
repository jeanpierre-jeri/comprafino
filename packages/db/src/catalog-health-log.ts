import { z } from "zod";

const capacityObservation = z
  .object({
    operation: z.literal("catalog_capacity"),
    skippedByCapacity: z.number().int().nonnegative().safe(),
  })
  .strict();

/** Only the explicit structured marker is evidence; source totals cannot imply capacity skips. */
export function readCatalogCapacityLog(text: string): number {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) {
    throw new Error("Acquisition log exceeds health-check bound");
  }
  const observations: number[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith('{"operation":"catalog_capacity"')) continue;
    const raw: unknown = JSON.parse(line);
    observations.push(capacityObservation.parse(raw).skippedByCapacity);
  }
  if (observations.length !== 1) {
    throw new Error("Expected one acquisition capacity observation");
  }
  return observations[0]!;
}
