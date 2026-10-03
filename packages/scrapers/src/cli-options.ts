export function parseArguments(args: readonly string[]) {
  let category: "dairy" | undefined;
  let dryRun = false;
  let limit = 20;
  let retailer: "tottus" | "plaza-vea" | "metro" = "tottus";
  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--retailer=plaza-vea") {
      retailer = "plaza-vea";
      continue;
    }
    if (arg === "--retailer=metro") {
      retailer = "metro";
      continue;
    }
    if (arg === "--category=dairy") category = "dairy";
    else if (arg === "--dry-run") dryRun = true;
    else if (/^--limit=\d+$/u.test(arg)) limit = Number(arg.slice(8));
    else
      throw new Error(
        "Usage: pnpm scrape:<retailer> -- --dry-run --limit=20 --category=dairy (limit 1–500)",
      );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Limit must be from 1 to 500");
  return { dryRun, limit, retailer, category };
}
