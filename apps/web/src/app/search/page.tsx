import { logDiagnostic } from "../../server/diagnostics.ts";
import { AddShoppingItem } from "../../components/shopping-list/shopping-item-editor";
import { Suspense } from "react";
import { SearchPageLoading } from "../../components/page-loading";
import type { Metadata } from "next";
import { after } from "next/server";
import {
  createDatabase,
  maximumSearchLength,
  searchPublicProducts,
  searchFilters,
  usefulSearchQuery,
  discoveryQueryForSearch,
  recordDiscoveryForSearch,
} from "@comprafino/db";
import type { ProductComparison, GenericProductOffer } from "@comprafino/db";
import { SearchControls } from "../../components/search-controls";
import { SearchForm } from "../../components/search-form";
import { PriceNotice, PublicShell } from "../../components/public-shell";
import {
  SearchResultsContent,
  shoppingQuantityForSearch,
} from "../../components/search-results-content";

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
    <Suspense key={JSON.stringify(params)} fallback={<SearchPageLoading />}>
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
  const sort = filters.sort;
  let units: string[] = [];
  let underlyingCount = 0;
  let products: ProductComparison[] = [];
  let offers: GenericProductOffer[] = [];
  let failed = false;

  if (usefulSearchQuery(query)) {
    try {
      const db = createDatabase();
      const results = await searchPublicProducts(db, query, sort, observedNow, filters);
      products = results.products;
      offers = results.offers;
      units = results.availableUnits;
      underlyingCount = results.usefulResultCount;

      if (discoveryQueryForSearch(query, underlyingCount)) {
        // Database demand recording only, after the response. Retailer work is
        // exclusively performed by the scheduled command, never by this route.
        after(async () => {
          try {
            await recordDiscoveryForSearch(db, query, underlyingCount);
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
    <PublicShell>
      <div className="search-heading">
        <div>
          <p className="eyebrow">Precios con contexto</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Encuentra y compara
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Compara opciones para tu próxima compra.
          </p>
        </div>
        <SearchForm query={query.slice(0, maximumSearchLength)} />
      </div>
      {usefulSearchQuery(query) && !failed && (
        <SearchControls query={query} filters={filters} units={units} />
      )}
      {usefulSearchQuery(query) && (
        <AddShoppingItem
          seed={{
            label: query,
            query,
            canonicalId: null,
            quantity: shoppingQuantityForSearch(query, offers),
          }}
        />
      )}
      <section className="mt-6" aria-label="Resultados de búsqueda">
        {
          <SearchResultsContent
            query={query}
            filters={filters}
            products={products}
            offers={offers}
            failed={failed}
            underlyingCount={underlyingCount}
            observedNow={observedNow}
          />
        }
      </section>
      <PriceNotice />
    </PublicShell>
  );
}
