import { z } from "zod";
import { hostingStateSchema } from "./config.ts";

const expectationSchema = z.object({
  ids: z.array(z.uuid()),
  groups: z.array(z.array(z.uuid())),
  prices: z.array(
    z.object({ id: z.uuid(), ordinary: z.string(), conditional: z.array(z.string()) }),
  ),
  totalOffers: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
});
export const hostingReferencesSchema = z.object({
  state: hostingStateSchema,
  scenarios: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("search"),
          id: z.string(),
          path: z.string().startsWith("/search?"),
          expected: expectationSchema,
        }),
        z.object({
          kind: z.literal("basket"),
          id: z.string(),
          path: z.enum([
            "/api/list/evaluate?priceMode=standard",
            "/api/list/evaluate?priceMode=benefits",
          ]),
          body: z.string(),
          expected: z.string().regex(/^[0-9a-f]{64}$/u),
        }),
      ]),
    )
    .length(20),
});
export type HostingScenario = z.infer<typeof hostingReferencesSchema>["scenarios"][number];

export const hostingIdentitySchema = z.object({
  runId: z.string(),
  commit: z.string(),
  schema: z.string(),
  size: z.number(),
});
