import { z } from "zod";
import { retailerIdSchema } from "./listing.ts";
import { catalogPolicy } from "./catalog-policy.ts";

const origins = {
  tottus: "https://www.tottus.com.pe",
  "plaza-vea": "https://www.plazavea.com.pe",
  metro: "https://www.metro.pe",
  makro: "https://www.makro.plazavea.com.pe",
} as const;

export const catalogSourceSchema = z
  .object({
    retailer: retailerIdSchema,
    key: z.string().min(1).max(200),
    name: z.string().min(1).max(300),
    url: z.url(),
  })
  .superRefine((source, context) => {
    const origin = origins[source.retailer];
    const pathname = source.url.split(/[?#]/u)[0]!.slice(origin.length);
    const category = /[?&]fq=([^&]+)/u.exec(source.url)?.[1] ?? "";
    const validPath =
      source.retailer === "tottus"
        ? /^\/tottus-pe\/lista\/CATG\d+\/[^/]+$/u.test(pathname) && !source.url.includes("?")
        : pathname === "/api/catalog_system/pub/products/search" &&
          /^C%3A%2F(?:\d+%2F)+$/iu.test(category);
    if (!source.url.startsWith(`${origin}/`) || source.url.includes("#") || !validPath) {
      context.addIssue({ code: "custom", message: "Invalid public catalog source" });
    }
  });

export type CatalogSource = z.infer<typeof catalogSourceSchema>;

export const catalogSourceClaimSchema = catalogSourceSchema.safeExtend({
  id: z.uuid(),
  cursor: z.number().int().nonnegative(),
  token: z.uuid(),
});

export type CatalogSourceClaim = z.infer<typeof catalogSourceClaimSchema>;

export function parseAcquisitionOptions(args: readonly string[]) {
  let pages: number = catalogPolicy.acquisitionPagesPerRetailer;
  let dryRun = false;
  let retailer: z.infer<typeof retailerIdSchema> | undefined;
  const seen = new Set<string>();
  for (const argument of args.filter((value) => value !== "--")) {
    const key = argument.split("=")[0]!;
    if (seen.has(key)) {
      throw new Error("Duplicate acquisition option");
    }
    seen.add(key);
    if (/^--pages=\d+$/u.test(argument)) {
      pages = Number(argument.slice(8));
    } else if (argument.startsWith("--retailer=")) {
      retailer = retailerIdSchema.parse(argument.slice(11));
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error("Use --pages=1..1000, --retailer, --dry-run");
    }
  }
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 1000) {
    throw new Error("Acquisition pages must be 1..1000 per retailer");
  }
  return { pages, dryRun, retailer };
}
