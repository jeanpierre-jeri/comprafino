import type { VtexCategory } from "./staple-categories.ts";
import { isVtexCategory } from "./staple-categories.ts";

export function parseArguments(args: readonly string[]) {
  let category: VtexCategory | undefined;
  let dryRun = false;
  let limit = 20;
  let retailer: "tottus" | "plaza-vea" | "metro" | "makro" = "tottus";

  for (const arg of args) {
    if (arg === "--") {
      continue;
    }

    if (arg === "--retailer=plaza-vea") {
      retailer = "plaza-vea";
      continue;
    }

    if (arg === "--retailer=makro") {
      retailer = "makro";
      continue;
    }

    if (arg === "--retailer=metro") {
      retailer = "metro";
      continue;
    }

    if (arg.startsWith("--category=")) {
      const value = arg.slice(11);

      if (!isVtexCategory(value)) {
        throw new Error("Usage: unsupported retailer category");
      }

      category = value;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (/^--limit=\d+$/u.test(arg)) {
      limit = Number(arg.slice(8));
    } else {
      throw new Error(
        "Usage: pnpm scrape:<retailer> -- --dry-run --limit=20 --category=dairy|eggs (Metro)|sugar-brown|sugar-white|pasta|flour|oats|toilet-paper (staple limit 1–20; dairy 1–500)",
      );
    }
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Limit must be from 1 to 500");
  }

  if ((retailer === "plaza-vea" || retailer === "makro") && category === "eggs") {
    throw new Error("Usage: eggs source is Metro only");
  }

  if (retailer === "tottus" && category && category !== "dairy") {
    throw new Error("Usage: Tottus supports only its existing meat/dairy categories");
  }

  if (category && category !== "dairy" && limit > 20) {
    throw new Error("Limit must be at most 20 for staple categories");
  }

  return { dryRun, limit, retailer, category };
}
