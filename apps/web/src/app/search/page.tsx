import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import {
  createDatabase,
  maximumSearchLength,
  searchPublicProducts,
  searchFilters,
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
import { ExactProductCard, GenericOfferCard } from "../../components/offer-card";

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
      <section className="mt-6" aria-label="Resultados de búsqueda">
        {failed ? (
          <PublicDataError />
        ) : !usefulSearchQuery(query) ? (
          <p className="empty-surface">
            Escribe entre 2 y {maximumSearchLength} caracteres para buscar un producto.
          </p>
        ) : !products.length && !offers.length ? (
          <div className="empty-surface">
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
            <Link
              href={underlyingCount ? `/search?q=${encodeURIComponent(query)}` : "/search?q=leche"}
              className="card-link"
            >
              {underlyingCount ? "Quitar filtros" : "Explorar leche"}
              <span aria-hidden="true"> →</span>
            </Link>
          </div>
        ) : (
          <>
            {products.length > 0 && (
              <section className="exact-section" aria-label="Comparaciones del mismo producto">
                <h2 className="text-2xl font-semibold tracking-tight">Compara el mismo producto</h2>
                <p className="mt-2 mb-5 text-sm text-muted-foreground">
                  {products.length === 20 ? "Hasta 20" : products.length} productos para «{query}»
                </p>
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((product, index) => (
                    <li key={product.id}>
                      <ExactProductCard
                        product={product}
                        benefits={filters.priceMode === "benefits"}
                        eager={index === 0}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {offers.length > 0 && (
              <section className="mt-10" aria-label="Opciones en supermercados">
                <h2 className="text-2xl font-semibold tracking-tight">Opciones en supermercados</h2>
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
                <p className="mt-2 mb-5 text-sm text-muted-foreground">
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
                            <GenericOfferCard
                              offer={offer}
                              benefits={filters.priceMode === "benefits"}
                            />
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
