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
  shoppingWeekdays,
  shoppingPriceHistories,
  genericSubstitutionContexts,
  resolveProductFamilyQuery,
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
  genericOfferProjection,
  genericFamilyCandidatePredicate,
} from "./generic-offers.ts";
import {
  getCanonicalProductComparison,
  eligibleProductIdentitiesWithCurrentPrices,
} from "./public-products.ts";

import { shoppingHistoryRows, historyRowsSchema } from "./shopping-price-history.ts";
import { shoppingWeekdayRows, weekdayRowsSchema } from "./weekday-recommendation.ts";
import { shoppingSnapshotRow, shoppingSnapshotRows } from "./shopping-snapshot-transport.ts";

/** Read-only current market boundary. Exact eligibility and generic quantity
 * evidence come from existing public queries; no list data is persisted. */
export async function evaluateCurrentShoppingItem(
  db: ReturnType<typeof createDatabase>,
  item: ShoppingListItem,
  mode: PriceMode,
  now = new Date(),
) {
  if (item.listingId) {
    const result = await evaluateCurrentShoppingList(db, { version: 2, items: [item] }, mode, now);
    return result.evaluations[0]!;
  }

  const candidates: ShoppingCandidate[] = [];
  const product =
    item.intent === "generic" || !item.canonicalId
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
    imageUrl: o.imageUrl,
    retailerId: o.retailerId,
    retailerName: o.retailerName,
    url: o.url,
    ordinaryPriceCents: o.currentPriceCents,
    conditionalOffers: o.conditionalOffers,
    observedAt: o.observedAt,
    available: o.available,
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

/** One statement gives exact metadata and needed current candidates a consistent
 * snapshot. The overflow count still covers the complete current catalog. */
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
  let weekdayRows: unknown = [];
  let historyRows: unknown = [];

  if (list.items.length) {
    const ids = [
      ...new Set(
        list.items.flatMap((i) =>
          i.intent === "generic" || !i.canonicalId || i.listingId ? [] : [i.canonicalId],
        ),
      ),
    ];
    const listingIds = list.items.flatMap((item) => (item.listingId ? [item.listingId] : []));
    const listingPredicate = listingIds.length
      ? sql`listing_id in (${sql.join(
          listingIds.map((id) => sql`${id}::uuid`),
          sql`,`,
        )})`
      : sql`false`;
    const queryStarted = performance.now();
    const marketQueries = list.items.flatMap((item) => {
      if (item.intent === "strict") return [];
      // A preference's safe alternatives depend on its current canonical title,
      // not a saved query/profile. Keep the supported-family superset for it.
      if (item.intent === "preferred") {
        return Object.values(genericSubstitutionContexts).map((context) => context.query);
      }
      return [shoppingMarketQuery(item)];
    });
    const families = [
      ...new Set(
        marketQueries.flatMap((query) => {
          const interpretation = resolveProductFamilyQuery(query);
          return interpretation ? [interpretation.family] : [];
        }),
      ),
    ];
    const alternativePredicate = families.length
      ? sql`(${sql.join(
          families.map((family) => genericFamilyCandidatePredicate(family, sql`retailer_id`)),
          sql` or `,
        )})`
      : sql`false`;
    const exactPredicate = ids.length
      ? sql`"canonicalId" in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`,`,
        )})`
      : sql`false`;
    const [result] = await db.batch([
      // Inline the projection so counting the full catalog does not materialize
      // every listing's JSON/benefits before filtering the requested families.
      db.execute(sql`${eligibleProductIdentitiesWithCurrentPrices}, current_listings as not materialized (
      ${currentGenericOfferRows(now, null, "snapshot")}
    ) select jsonb_build_object(
      'currentCount',(select count(*)::int from current_listings),
      'weekdayRows', (${shoppingWeekdayRows(ids, now, listingIds, true)}),
      'historyRows', (${shoppingHistoryRows(ids, listingIds, now, true)}),
      'products', coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',"displayName"))
        from products where ${
          ids.length
            ? sql`id in (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql`false`
        }), '[]'::jsonb),
      'listings', coalesce((select jsonb_agg(jsonb_build_array(${genericOfferProjection})) from
        (select ${genericOfferProjection} from current_listings where ${exactPredicate} or ${alternativePredicate} or ${listingPredicate}
          or "canonicalId" in (select "canonicalId" from current_listings where ${listingPredicate})
          order by listing_id::text limit ${catalogPolicy.overflowSentinel}) bounded), '[]'::jsonb)
    ) as snapshot`),
    ]);
    queryMs = performance.now() - queryStarted;
    const snapshot = z
      .object({
        weekdayRows: z.unknown(),
        historyRows: z.unknown(),
        currentCount: z.number().int().nonnegative(),
        products: z.array(z.object({ id: z.uuid(), title: z.string().min(1) })),
        listings: z.array(z.unknown()),
      })
      .parse(result.rows[0]?.snapshot);

    if (
      snapshot.currentCount > catalogPolicy.retainedListingCap ||
      snapshot.listings.length > catalogPolicy.retainedListingCap
    ) {
      throw new Error("Shopping catalog snapshot bound exceeded");
    }

    weekdayRows = snapshot.weekdayRows;
    historyRows = snapshot.historyRows;

    for (const product of snapshot.products) {
      titles.set(product.id, product.title);
    }

    candidates = snapshot.listings
      .map((raw) => genericProductOffer(shoppingSnapshotRow("offer", raw), now, mode))
      .filter((offer) => offer !== null)
      .map(shoppingCandidate);
  }

  const fulfillments = list.items.map((item) => {
    // Missing public identity cannot authorize either exact purchase or preference fallback.
    const title = item.listingId
      ? candidates.find((candidate) => candidate.id === item.listingId)?.title
      : titles.get(item.canonicalId ?? "");

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
    weekdayRecommendations: shoppingWeekdays(
      list,
      candidates,
      weekdayRowsSchema.parse(shoppingSnapshotRows("weekday", weekdayRows)),
      now,
    ),
    priceHistories: shoppingPriceHistories(
      list,
      fulfillments.map((f) => f.evaluation),
      historyRowsSchema.parse(shoppingSnapshotRows("history", historyRows)),
      now,
    ),
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
