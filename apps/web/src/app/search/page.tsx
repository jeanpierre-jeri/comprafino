import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import {
  createDatabase,
  formatPen,
  maximumSearchLength,
  searchPublicProducts,
  searchFilters,
  formatUnitPrice,
  unitPriceBases,
  unitPriceBasisLabel,
  usefulSearchQuery,
  discoveryQueryForSearch,
  recordDiscoveryForSearch,
} from "@comprafino/db";
import type { ProductComparison, GenericProductOffer } from "@comprafino/db";
import { SearchControls } from "../../components/search-controls";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
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
      const results = await searchPublicProducts(db, query, sort, undefined, filters);
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
      {usefulSearchQuery(query) && !failed && (
        <SearchControls query={query} filters={filters} units={units} />
      )}
      <section className="mt-6" aria-label="Resultados de búsqueda">
        {failed ? (
          <PublicDataError />
        ) : !usefulSearchQuery(query) ? (
          <p className="rounded-xl border p-6">
            Escribe entre 2 y {maximumSearchLength} caracteres para buscar un producto.
          </p>
        ) : !products.length && !offers.length ? (
          <div className="rounded-xl border p-6">
            <h2 className="text-xl font-semibold">
              {underlyingCount
                ? "No hay opciones con estos filtros."
                : "No encontramos ese producto todavía."}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {underlyingCount
                ? "Prueba otro supermercado o selecciona todas las medidas."
                : "Tomamos en cuenta las búsquedas sin resultados para ampliar el catálogo. Prueba con otra marca o producto."}
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
                      <article className="h-full rounded-2xl border p-4 shadow-sm">
                        <Link
                          href={`/products/${product.id}${filters.priceMode === "benefits" ? "?priceMode=benefits" : ""}`}
                          className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                        >
                          <ProductImage
                            compact
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
                                  {formatPen(
                                    filters.priceMode === "benefits"
                                      ? (product.bestRanking?.priceCents ??
                                          product.lowestPriceCents)
                                      : product.lowestPriceCents,
                                  )}
                                </strong>
                              </p>
                              <p className="mt-1 text-sm">
                                {(filters.priceMode === "benefits"
                                  ? (product.bestRanking?.retailers ?? product.cheapestRetailers)
                                  : product.cheapestRetailers
                                ).join(" y ")}
                                {filters.priceMode === "benefits" &&
                                  product.bestRanking?.conditions.map((condition) => (
                                    <span className="block font-medium" key={condition}>
                                      {condition}
                                    </span>
                                  ))}
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
                              (filters.priceMode === "benefits"
                                ? offer.ranking.priceCents === product.bestRanking?.priceCents
                                : offer.currentPriceCents === product.lowestPriceCents),
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
                {offers.some((offer) => offer.family.family === "toilet_paper") && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    El precio por rollo es orientativo: el tamaño y la cantidad de hojas pueden
                    variar.
                  </p>
                )}
                {offers.some((offer) => offer.family.family === "canned_tuna") && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    El peso del atún puede incluir líquido. No mostramos precio por kg sin
                    distinguir peso neto y escurrido.
                  </p>
                )}
                <p className="mb-4 text-sm text-muted-foreground">
                  {offers.length === 30 ? "Hasta 30" : offers.length} ofertas para «{query}»
                </p>
                {(sort === "unit-price"
                  ? [...unitPriceBases, "unknown"]
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
                          : (offer.unitPrice?.basis ?? "unknown") === group),
                  );
                  if (!members.length) return null;
                  const label =
                    group === "mass" ||
                    group === "volume" ||
                    group === "item-count" ||
                    group === "roll" ||
                    group === "unknown"
                      ? unitPriceBasisLabel(group)
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
                              className="h-full rounded-2xl border p-4 shadow-sm"
                            >
                              <ProductImage
                                compact
                                src={offer.imageUrl}
                                name={offer.title}
                                loading="lazy"
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
                              <p className="text-xs text-muted-foreground">
                                Precio online para todos
                              </p>
                              {offer.regularPriceCents !== null && (
                                <p className="text-xs text-muted-foreground">
                                  Antes <s>{formatPen(offer.regularPriceCents)}</s>
                                </p>
                              )}
                              {offer.unitPrice && offer.pricingBasis !== "kg" && (
                                <p className="mt-1 text-sm">
                                  {formatUnitPrice(offer.unitPrice)}
                                  {offer.ranking.condition ? " · con CMR" : ""}
                                  {offer.unitPrice.quality === "approximate"
                                    ? " · orientativo"
                                    : ""}
                                </p>
                              )}
                              {offer.conditionalOffers.map((benefit) => (
                                <p
                                  key={benefit.programKey}
                                  className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm"
                                >
                                  <strong>Con CMR: {formatPen(benefit.priceCents)}</strong>
                                  {offer.pricingBasis === "kg" ? " / kg" : ""}
                                  <span className="block text-xs">{benefit.conditionLabel}</span>
                                </p>
                              ))}
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
                                  href={`/products/${offer.canonicalId}${filters.priceMode === "benefits" ? "?priceMode=benefits" : ""}`}
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
