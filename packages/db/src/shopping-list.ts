import { catalogQuantityToShoppingUnit } from "@comprafino/core";
import { catalogPolicy } from "@comprafino/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  evaluateShoppingListItem,
  evaluateShoppingFulfillment,
  basketOptionSchema,
  optimizeBasket,
  getSubstitutionProfile,
  searchFilters,
  shoppingQueryForTitle,
  shoppingMarketQuery,
} from "@comprafino/core";
import type {
  PriceMode,
  ShoppingCandidate,
  ShoppingListItem,
  ShoppingList,
} from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import {
  searchGenericProductOffers,
  getCanonicalCurrentProductOffers,
  currentGenericOfferRows,
  genericProductOffer,
} from "./generic-offers.ts";
import { getCanonicalProductComparison, eligibleProducts } from "./public-products.ts";

/** Read-only current market boundary. Exact eligibility and generic quantity
 * evidence come from existing public queries; no list data is persisted. */
export async function evaluateCurrentShoppingItem(
  db: ReturnType<typeof createDatabase>,
  item: ShoppingListItem,
  mode: PriceMode,
  now = new Date(),
) {
  const candidates: ShoppingCandidate[] = [];
  const product =
    item.intent === "generic"
      ? null
      : await getCanonicalProductComparison(db, item.canonicalId, now, mode);

  if (product) {
    const exactOffers = await getCanonicalCurrentProductOffers(db, product.id, now, mode);

    for (const offer of exactOffers) {
      candidates.push(shoppingCandidate(offer));
    }
  }

  if (item.intent !== "strict") {
    // Derive the family from the current canonical identity, never a saved brand
    // query, so a preference cannot hide another brand's market opportunity.
    let query;

    if (product) {
      query = shoppingQueryForTitle(product.displayName);
    } else if (item.intent === "generic") {
      query = shoppingMarketQuery(item);
    } else {
      query = null;
    }

    if (query) {
      const offers = await searchGenericProductOffers(
        db,
        query,
        "relevance",
        now,
        searchFilters({ priceMode: mode }),
        true,
      );

      for (const o of offers) {
        // Independent normalized offers are valid generic options. A null public
        // canonical ID must never become an exact-product/history association.
        if (product && o.canonicalId === product.id) {
          continue;
        }

        candidates.push(shoppingCandidate(o));
      }
    }
  }

  return evaluateShoppingListItem(item, candidates, mode, now, product?.displayName);
}

function shoppingCandidate(
  o: Awaited<ReturnType<typeof searchGenericProductOffers>>[number],
): ShoppingCandidate {
  const q = o.totalQuantity;

  return {
    id: o.id,
    canonicalId: o.canonicalId,
    title: o.title,
    retailerId: o.retailerId,
    retailerName: o.retailerName,
    url: o.url,
    ordinaryPriceCents: o.currentPriceCents,
    conditionalOffers: o.conditionalOffers,
    observedAt: o.observedAt,
    available: true,
    packageQuantity:
      q && o.pricingBasis === "unit"
        ? {
            amount: q.value / (q.unit === "unit" ? 1 : 1000),
            unit: catalogQuantityToShoppingUnit(q.unit),
          }
        : null,
    strongQuantity: o.unitPrice?.quality === "strong",
    pricingBasis: o.pricingBasis,
    substitutionProfile: getSubstitutionProfile(o),
  };
}

/** One statement gives exact metadata and all current candidates a consistent
 * snapshot. Bounded full-catalog retrieval is intentional at the current scale. */
export async function evaluateCurrentShoppingList(
  db: ReturnType<typeof createDatabase>,
  list: ShoppingList,
  mode: PriceMode,
  now = new Date(),
) {
  const started = performance.now();
  let queryMs = 0;
  let candidates: ShoppingCandidate[] = [];
  const titles = new Map<string, string>();

  if (list.items.length) {
    const ids = [
      ...new Set(list.items.flatMap((i) => (i.intent === "generic" ? [] : [i.canonicalId]))),
    ];
    const queryStarted = performance.now();
    const [result] = await db.batch([
      db.execute(sql`${eligibleProducts}, current_listings as (
      ${currentGenericOfferRows(now)}
    ) select jsonb_build_object(
      'products', coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',"displayName"))
        from products where ${
          ids.length
            ? sql`id in (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql`false`
        }), '[]'::jsonb),
      'listings', coalesce((select jsonb_agg(row_to_json(bounded)) from
        (select * from current_listings order by listing->>'id' limit ${catalogPolicy.overflowSentinel}) bounded), '[]'::jsonb)
    ) as snapshot`),
    ]);
    queryMs = performance.now() - queryStarted;
    const snapshot = z
      .object({
        products: z.array(z.object({ id: z.uuid(), title: z.string().min(1) })),
        listings: z.array(z.unknown()),
      })
      .parse(result.rows[0]?.snapshot);

    if (snapshot.listings.length > catalogPolicy.retainedListingCap) {
      throw new Error("Shopping catalog snapshot bound exceeded");
    }

    for (const product of snapshot.products) {
      titles.set(product.id, product.title);
    }

    candidates = snapshot.listings
      .map((raw) => genericProductOffer(raw, now, mode))
      .filter((offer) => offer !== null)
      .map(shoppingCandidate);
  }

  const fulfillments = list.items.map((item) => {
    // Missing public identity cannot authorize either exact purchase or preference fallback.
    const title = item.intent === "generic" ? undefined : titles.get(item.canonicalId);

    return evaluateShoppingFulfillment(
      item,
      item.intent !== "generic" && !title ? [] : candidates,
      mode,
      now,
      title,
    );
  });

  return {
    evaluations: fulfillments.map((f) => f.evaluation),
    baskets: optimizeBasket(
      fulfillments.map((f) => ({
        itemId: f.evaluation.itemId,
        options: f.approved.map((o) => basketOptionSchema.parse(o)),
      })),
    ),
    evaluatedAt: now.toISOString(),
    timings: { queryMs, totalMs: performance.now() - started },
  };
}
