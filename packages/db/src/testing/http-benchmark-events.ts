import { z } from "zod";

const eventSchema = z
  .object({
    type: z.string(),
    at: z.number(),
    id: z.string().optional(),
    token: z.string().optional(),
  })
  .passthrough();

export function parseBenchmarkEvent(value: unknown) {
  return eventSchema.parse(value);
}

export function parseBenchmarkStatements(value: unknown) {
  return z.array(z.object({ query: z.string(), params: z.array(z.unknown()) })).parse(value);
}
