import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import {
  createDatabase,
  formatPen,
  maximumSearchLength,
  searchPublicProducts,
  genericOfferSort,
  formatUnitPrice,
  usefulSearchQuery,
  discoveryQueryForSearch,
  recordDiscoveryForSearch,
} from "@comprafino/db";
import type { ProductComparison, GenericProductOffer } from "@comprafino/db";
import { SearchForm } from "../../components/search-form";
import { PriceNotice, PublicDataError, PublicShell } from "../../components/public-shell";
import { ProductImage } from "../../components/product-image";
import { ObservedAt, packageSummary } from "../../components/product-info";

export const metadata: Metadata = {
  title: "Buscar productos y precios | CompraFino",
};
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; sort?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const sort = genericOfferSort(params.sort);
  let products: ProductComparison[] = [];
  let offers: GenericProductOffer[] = [];
  let failed = false;
  if (usefulSearchQuery(query)) {
    try {
      const db = createDatabase();
      const results = await searchPublicProducts(db, query, sort);
      products = results.products;
      offers = results.offers;
      if (discoveryQueryForSearch(query, products.length + offers.length)) {
        // Database demand recording only, after the response. Retailer work is
        // exclusively performed by the scheduled command, never by this route.
        after(async () => {
          try {
            await recordDiscoveryForSearch(db, query, products.length + offers.length);
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
        ) : !products.length && !offers.length ? (
          <div className="rounded-xl border p-6">
            <h2 className="text-xl font-semibold">No encontramos ese producto todavía.</h2>
            <p className="mt-2 text-muted-foreground">
              Tomamos en cuenta las búsquedas sin resultados para ampliar el catálogo. Prueba con
              otra marca o producto.
            </p>
          </div>
        ) : (
          <>
            {products.length > 0 && (
              <section aria-label="Comparaciones del mismo producto">
                <h2 className="mb-4 text-xl font-semibold">Compara el mismo producto</h2>
                <p className="mb-5 text-sm text-muted-foreground">
                  {products.length === 20 ? "Hasta 20" : products.length} productos para «{query}»
                </p>
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((product, index) => (
                    <li key={product.id}>
                      <article className="h-full rounded-2xl border p-5">
                        <Link
                          href={`/products/${product.id}`}
                          className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                        >
                          <ProductImage
                            src={product.imageUrl}
                            name={product.displayName}
                            loading={index === 0 ? "eager" : "lazy"}
                          />
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
                              <p className="mt-1 text-sm">
                                {product.cheapestRetailers.join(" y ")}
                              </p>
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
              </section>
            )}
            {offers.length > 0 && (
              <section className="mt-8" aria-label="Opciones en supermercados">
                <h2 className="text-xl font-semibold">Opciones en supermercados</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Compara cantidades y precios. Las marcas, variedades y calidades pueden diferir.
                </p>
                <form
                  action="/search"
                  method="get"
                  className="my-5 flex flex-wrap items-center gap-3"
                >
                  <input type="hidden" name="q" value={query} />
                  <label htmlFor="sort">Ordenar:</label>
                  <select
                    id="sort"
                    name="sort"
                    defaultValue={sort}
                    className="rounded-lg border bg-background p-2"
                  >
                    <option value="relevance">Relevancia</option>
                    <option value="total-price">Menor precio</option>
                    <option value="unit-price">Mejor precio por unidad</option>
                  </select>
                  <button type="submit" className="rounded-lg border px-4 py-2">
                    Aplicar
                  </button>
                </form>
                <p className="mb-4 text-sm text-muted-foreground">
                  {offers.length === 30 ? "Hasta 30" : offers.length} ofertas para «{query}»
                </p>
                {(sort === "unit-price"
                  ? ["mass", "volume", "count", "unknown"]
                  : sort === "total-price"
                    ? ["package", "direct"]
                    : ["all"]
                ).map((group) => {
                  const members = offers.filter(
                    (offer) =>
                      group === "all" ||
                      (group === "package"
                        ? offer.pricingBasis === "unit"
                        : group === "direct"
                          ? offer.pricingBasis === "kg"
                          : (offer.unitPrice?.dimension ?? "unknown") === group),
                  );
                  if (!members.length) return null;
                  const label =
                    group === "mass"
                      ? "Precio por kg"
                      : group === "volume"
                        ? "Precio por litro"
                        : group === "count"
                          ? "Precio por unidad"
                          : group === "unknown"
                            ? "Otras opciones sin precio por unidad"
                            : group === "direct"
                              ? "Precios por kg"
                              : group === "package"
                                ? "Precio del paquete"
                                : null;
                  return (
                    <div key={group} className="mb-6">
                      {label && <h3 className="mb-3 font-semibold">{label}</h3>}
                      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {members.map((offer) => (
                          <li key={offer.id}>
                            <article
                              data-offer-id={offer.id}
                              className="h-full rounded-2xl border p-5"
                            >
                              <ProductImage
                                src={offer.imageUrl}
                                name={offer.title}
                                loading="eager"
                              />
                              {offer.brand && (
                                <p className="mt-4 text-sm text-muted-foreground">{offer.brand}</p>
                              )}
                              <h3 className="mt-1 text-lg font-semibold">{offer.title}</h3>
                              {offer.quantity && offer.packageCount && (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  {packageSummary({
                                    quantityValue: offer.quantity.value,
                                    quantityUnit: offer.quantity.unit,
                                    packageCount: offer.packageCount,
                                  })}
                                </p>
                              )}
                              <p className="mt-3">{offer.retailerName}</p>
                              <p className="mt-2 text-2xl font-semibold text-primary">
                                {formatPen(offer.currentPriceCents)}
                                {offer.pricingBasis === "kg" ? " / kg" : ""}
                              </p>
                              {offer.unitPrice && offer.pricingBasis !== "kg" && (
                                <p className="mt-1 text-sm">{formatUnitPrice(offer.unitPrice)}</p>
                              )}
                              <ObservedAt date={offer.observedAt} />
                              <a
                                href={offer.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-4 block text-sm underline"
                              >
                                Ver producto en {offer.retailerName} (nueva pestaña)
                              </a>
                              {offer.canonicalId && (
                                <Link
                                  href={`/products/${offer.canonicalId}`}
                                  className="mt-3 block text-sm underline"
                                >
                                  Comparar este producto en {offer.retailerCount} supermercados
                                </Link>
                              )}
                            </article>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
      </section>
      <PriceNotice />
    </PublicShell>
  );
}
