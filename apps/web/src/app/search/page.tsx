import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import {
  createDatabase,
  formatPen,
  maximumSearchLength,
  searchCanonicalProducts,
  usefulSearchQuery,
  discoveryQueryForSearch,
  recordDiscoveryForSearch,
} from "@comprafino/db";
import type { ProductComparison } from "@comprafino/db";
import { SearchForm } from "../../components/search-form";
import { PriceNotice, PublicDataError, PublicShell } from "../../components/public-shell";
import { ProductImage } from "../../components/product-image";
import { ObservedAt, packageSummary } from "../../components/product-info";

export const metadata: Metadata = { title: "Buscar productos y precios | CompraFino" };
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  let products: ProductComparison[] = [];
  let failed = false;
  if (usefulSearchQuery(query)) {
    try {
      const db = createDatabase();
      products = await searchCanonicalProducts(db, query);
      if (discoveryQueryForSearch(query, products.length)) {
        // Database demand recording only, after the response. Retailer work is
        // exclusively performed by the scheduled command, never by this route.
        after(async () => {
          try {
            await recordDiscoveryForSearch(db, query, products.length);
          } catch {
            console.error("Discovery demand recording failed.");
          }
        });
      }
    } catch {
      console.error("Public search database query failed.");
      failed = true;
    }
  }
  return (
    <PublicShell>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Encuentra y compara</h1>
      <SearchForm query={query.slice(0, maximumSearchLength)} />
      <section className="mt-10" aria-label="Resultados de búsqueda">
        {failed ? (
          <PublicDataError />
        ) : !usefulSearchQuery(query) ? (
          <p className="rounded-xl border p-6">
            Escribe entre 2 y {maximumSearchLength} caracteres para buscar un producto.
          </p>
        ) : !products.length ? (
          <div className="rounded-xl border p-6">
            <h2 className="text-xl font-semibold">No encontramos ese producto todavía.</h2>
            <p className="mt-2 text-muted-foreground">
              Tomamos en cuenta las búsquedas sin resultados para ampliar el catálogo. Prueba con
              otra marca o producto.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              {products.length === 20 ? "Hasta 20" : products.length} productos para «{query}»
            </p>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <li key={product.id}>
                  <article className="h-full rounded-2xl border p-5">
                    <Link
                      href={`/products/${product.id}`}
                      className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                    >
                      <ProductImage src={product.imageUrl} name={product.displayName} />
                      <p className="mt-4 text-sm text-muted-foreground">{product.brand}</p>
                      <h2 className="mt-1 text-lg font-semibold group-hover:text-primary">
                        {product.displayName}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {packageSummary(product)}
                      </p>
                      {product.lowestPriceCents === null ? (
                        <p className="mt-5 text-sm text-muted-foreground">
                          Estamos actualizando este producto.
                        </p>
                      ) : (
                        <>
                          <p className="mt-5 text-sm">
                            Desde{" "}
                            <strong className="text-2xl text-primary">
                              {formatPen(product.lowestPriceCents)}
                            </strong>
                          </p>
                          <p className="mt-1 text-sm">{product.cheapestRetailers.join(" y ")}</p>
                        </>
                      )}
                      <p className="mt-2 text-sm text-muted-foreground">
                        {product.retailerCount} supermercados · Ver comparación
                      </p>
                    </Link>
                    {product.offers
                      .filter(
                        (offer) =>
                          offer.freshness === "fresh" &&
                          offer.available !== false &&
                          offer.currentPriceCents === product.lowestPriceCents,
                      )
                      .map((offer) => (
                        <div key={offer.retailerId}>
                          <span className="sr-only">{offer.retailerName}: </span>
                          <ObservedAt date={offer.observedAt} />
                        </div>
                      ))}
                  </article>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <PriceNotice />
    </PublicShell>
  );
}
