import { logDiagnostic } from "../../server/diagnostics.ts";
import { AddShoppingItem } from "../../components/shopping-list/shopping-item-editor";
import { Suspense } from "react";
import { SearchPageLoading } from "../../components/page-loading";
import type { Metadata } from "next";
import { after } from "next/server";
import {
  createDatabase,
  maximumSearchLength,
  searchGroupedPublicProducts,
  searchFilters,
  usefulSearchQuery,
  discoveryQueryForSearch,
  recordDiscoveryForSearch,
  requestCatalogRefresh,
} from "@comprafino/db";
import type { SearchProductResult } from "@comprafino/db";
import Link from "next/link";
import { searchFilterQuery } from "@comprafino/core/search-filters";
import { searchCategory, usefulSearchRequest } from "@comprafino/core";
import { SearchControls } from "../../components/search-controls";
import { SearchForm } from "../../components/search-form";
import { PriceNotice, PublicShell } from "../../components/public-shell";
import {
  SearchResultsContent,
  shoppingQuantityForSearch,
} from "../../components/search-results-content";
import { withPublicDatabase } from "../../server/public-database.ts";
import { withinRequestBudget } from "../../lib/request-budget.ts";
import { publicRequestPolicy } from "../../lib/public-request-policy.ts";
import { SearchScrollRestoration } from "../../components/search-scroll-restoration";

export const maxDuration = 30;

export const metadata: Metadata = {
  title: "Buscar productos y precios | CompraFino",
};

async function loadSearchContext(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
) {
  return { params: await searchParams, observedNow: new Date() };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { params, observedNow } = await loadSearchContext(searchParams);

  return (
    <Suspense fallback={<SearchPageLoading />}>
      <SearchResults params={params} observedNow={observedNow} />
    </Suspense>
  );
}

async function SearchResults({
  params,
  observedNow,
}: {
  params: Record<string, string | string[] | undefined>;
  observedNow: Date;
}) {
  const query = typeof params.q === "string" ? params.q : "";
  const filters = searchFilters(params);
  const category = searchCategory(filters.category);
  const validRequest = usefulSearchRequest(query, filters.category);
  const sort = filters.sort;
  let units: string[] = [];
  let underlyingCount = 0;
  let products: SearchProductResult[] = [];
  let failed = false;
  const rawPage =
    typeof params.page === "string" && /^\d{1,4}$/u.test(params.page) ? Number(params.page) : 1;
  const page = Math.max(1, Math.min(rawPage, 2500));
  let hasMore = false;
  let totalOffers = 0;
  let totalProducts = 0;

  if (validRequest) {
    try {
      const results = await withPublicDatabase((db) =>
        searchGroupedPublicProducts(db, query, sort, observedNow, filters, page),
      );
      products = results.products;
      units = results.availableUnits;
      underlyingCount = results.usefulResultCount;
      hasMore = results.hasMore;
      totalOffers = results.totalOffers;
      totalProducts = results.totalProducts;

      if (
        (usefulSearchQuery(query) &&
          discoveryQueryForSearch(
            query,
            results.discoveryRetailers.length ? 0 : underlyingCount,
          )) ||
        results.refreshListingIds.length
      ) {
        // Database demand recording only, after the response. Retailer work is
        // exclusively performed by the scheduled command, never by this route.
        after(async () => {
          try {
            await withinRequestBudget(publicRequestPolicy.demandMs, undefined, async (signal) => {
              const db = createDatabase(process.env, {
                signal,
                requestTimeoutMs: publicRequestPolicy.demandMs,
                statementTimeoutMs: publicRequestPolicy.demandStatementMs,
              });
              if (usefulSearchQuery(query)) {
                await recordDiscoveryForSearch(
                  db,
                  query,
                  underlyingCount,
                  results.discoveryRetailers,
                );
              }
              await requestCatalogRefresh(db, results.refreshListingIds);
            });
          } catch (error) {
            logDiagnostic(error, {
              stage: "public",
              operation: "discovery",
              reason: "db_write_failed",
            });
          }
        });
      }
    } catch (error) {
      logDiagnostic(error, { stage: "public", operation: "search", reason: "db_read_failed" });
      failed = true;
    }
  }

  return (
    <PublicShell compact>
      <div className="search-heading">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {category?.label ?? "Encuentra y compara"}
        </h1>
        <SearchForm compact query={query.slice(0, maximumSearchLength)} filters={filters} />
      </div>
      {!failed && (
        <SearchControls
          query={query}
          filters={filters}
          units={units}
          resultSummary={
            validRequest
              ? `${totalProducts} ${totalProducts === 1 ? "producto" : "productos"} · ${totalOffers} ${totalOffers === 1 ? "oferta de tienda" : "ofertas de tienda"}${page > 1 ? ` · Página ${page}` : ""}`
              : "Busca un producto"
          }
        />
      )}
      <section className="mt-4" aria-label="Resultados de búsqueda">
        {
          <SearchResultsContent
            query={query}
            filters={filters}
            products={products}
            failed={failed}
            underlyingCount={underlyingCount}
            observedNow={observedNow}
            returnTo={`/search?${searchFilterQuery(query, filters)}&page=${page}`}
          />
        }
      </section>
      {!failed && validRequest && (page > 1 || hasMore) && (
        <nav aria-label="Páginas de resultados" className="mt-6 flex flex-wrap items-center gap-4">
          {page > 1 && (
            <Link
              className="card-link"
              href={`/search?${searchFilterQuery(query, filters)}&page=${page - 1}`}
            >
              Anterior
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} · {totalProducts} productos · {totalOffers} ofertas de tienda
          </span>
          {hasMore && (
            <Link
              className="card-link"
              href={`/search?${searchFilterQuery(query, filters)}&page=${page + 1}`}
            >
              Siguiente
            </Link>
          )}
        </nav>
      )}
      {usefulSearchQuery(query) && (
        <AddShoppingItem
          seed={{
            label: query,
            query,
            canonicalId: null,
            quantity: shoppingQuantityForSearch(
              query,
              products.map((product) => product.rankingOffer),
            ),
          }}
        />
      )}
      <PriceNotice />
      <SearchScrollRestoration />
    </PublicShell>
  );
}
