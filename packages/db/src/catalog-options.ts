import { retailerIdSchema } from "@comprafino/core";
import type { RetailerId } from "@comprafino/core";
export function parseCatalogOptions(args: readonly string[]): {
  limit: number;
  retailer?: RetailerId;
  dryRun: boolean;
} {
  let limit = 100;
  let retailer: RetailerId | undefined;
  let dryRun = false;
  const seen = new Set<string>();
  for (const arg of args.filter((value) => value !== "--")) {
    const key = arg.split("=")[0]!;
    if (seen.has(key)) throw new Error("Duplicate option");
    seen.add(key);
    if (/^--limit=\d+$/u.test(arg)) limit = Number(arg.slice(8));
    else if (arg.startsWith("--retailer=")) retailer = retailerIdSchema.parse(arg.slice(11));
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error("Use --limit=1..5000, --retailer=tottus|plaza-vea|metro, --dry-run");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
    throw new Error("Limit must be an integer from 1 to 5000");
  return { limit, retailer, dryRun };
}
