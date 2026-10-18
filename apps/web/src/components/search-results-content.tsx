import Link from "next/link";
import { unitPriceBases, unitPriceBasisLabel } from "@comprafino/core";
import type { UnitPriceBasis, ShoppingListItem } from "@comprafino/core";
import { maximumSearchLength, usefulSearchQuery } from "@comprafino/db";
import type { GenericProductOffer, SearchProductResult } from "@comprafino/db";
import type { SearchFilters } from "@comprafino/core/search-filters";
import { searchFilters, searchFilterQuery, usefulSearchRequest } from "@comprafino/core";
import { PublicDataError } from "./public-shell";
import { SearchProductCard } from "./offer-card";

type Props = {
  query: string;
  filters: SearchFilters;
  products: SearchProductResult[];
  failed: boolean;
  underlyingCount: number;
  observedNow: Date;
  returnTo?: string;
};

type OfferGroup = UnitPriceBasis | "unknown" | "package" | "direct" | "all";

export function SearchResultsContent({
  query,
  filters,
  products,
  failed,
  underlyingCount,
  observedNow,
  returnTo,
}: Props) {
  if (failed) return <PublicDataError />;

  if (!usefulSearchRequest(query, filters.category)) {
    return (
      <p className="empty-surface">
        Escribe entre 2 y {maximumSearchLength} caracteres para buscar un producto.
      </p>
    );
  }

  if (!products.length) {
    if (filters.category) {
      return (
        <div className="empty-surface">
          <h2 className="text-xl font-semibold">
            No hay opciones con esta categoría y estos filtros.
          </h2>
          <p className="mt-2 text-muted-foreground">
            {filters.retailer || filters.unit
              ? "Prueba sin los filtros de supermercado y medida, o busca en otras categorías."
              : "Prueba con menos palabras o revisa otras categorías."}
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            {(filters.retailer || filters.unit) && (
              <Link
                href={`/search?${searchFilterQuery(query, searchFilters({ category: filters.category, sort: filters.sort, priceMode: filters.priceMode }))}`}
                className="card-link"
              >
                Quitar filtros de supermercado y medida
              </Link>
            )}
            <Link
              href={usefulSearchQuery(query) ? `/search?q=${encodeURIComponent(query)}` : "/"}
              className="card-link"
            >
              {usefulSearchQuery(query) ? "Buscar en todas las categorías" : "Ver otras categorías"}
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="empty-surface">
        <h2 className="text-xl font-semibold">
          {underlyingCount
            ? "No hay opciones con estos filtros."
            : "No encontramos productos para esta búsqueda."}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {underlyingCount
            ? "Quita los filtros para ver las opciones que encontramos para tu búsqueda."
            : "Revisa cómo lo escribiste o prueba con menos palabras, sin la marca o el tamaño."}
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          {underlyingCount ? (
            <Link href={`/search?q=${encodeURIComponent(query)}`} className="card-link">
              Quitar filtros
            </Link>
          ) : (
            <>
              <a href="#product-search" className="card-link">
                Cambiar búsqueda
              </a>
              <Link href="/" className="card-link">
                Ver categorías
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Opciones en supermercados">
      <h2 className="sr-only">Productos</h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Compara cantidades y precios. Las marcas, variedades y calidades pueden diferir.
      </p>
      {products.some((product) => product.representative.family.family === "toilet_paper") && (
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          El precio por rollo es orientativo: el tamaño y la cantidad de hojas pueden variar.
        </p>
      )}
      {products.some((product) => product.representative.family.family === "canned_tuna") && (
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          El peso del atún puede incluir líquido. No mostramos precio por kg sin distinguir peso
          neto y escurrido.
        </p>
      )}
      {offerGroups(filters.sort).map((group) => {
        const members = products.filter(
          (offer) => group === "all" || offerMatchesGroup(offer, group),
        );

        if (!members.length) return null;

        const label = offerGroupLabel(group);

        return (
          <div key={group} className="mb-6">
            {label && <h3 className="mb-3 font-semibold">{label}</h3>}
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((offer) => (
                <li key={offer.id}>
                  <SearchProductCard
                    product={offer}
                    observedNow={observedNow}
                    benefits={filters.priceMode === "benefits"}
                    eager={offer.id === products[0]?.id}
                    returnTo={returnTo}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

export function shoppingQuantityForSearch(
  query: string,
  offers: readonly GenericProductOffer[],
): ShoppingListItem["quantity"] {
  const dimension = offers.find((offer) => offer.unitPrice?.quality === "strong")?.unitPrice
    ?.dimension;

  if (dimension === "mass") return { amount: 1, unit: "kg" };

  if (dimension === "volume") return { amount: 1, unit: "L" };

  return { amount: query.toLowerCase().startsWith("huevo") ? 30 : 1, unit: "unit" };
}

function offerGroups(sort: SearchFilters["sort"]): OfferGroup[] {
  if (sort === "unit-price") return [...unitPriceBases, "unknown"];

  if (sort === "total-price") return ["package", "direct"];

  return ["all"];
}

function offerMatchesGroup(
  offer: Pick<GenericProductOffer, "unitPrice" | "pricingBasis">,
  group: OfferGroup,
): boolean {
  switch (group) {
    case "all":
      return true;
    case "package":
      return offer.pricingBasis === "unit";
    case "direct":
      return offer.pricingBasis === "kg";
    default:
      return (offer.unitPrice?.basis ?? "unknown") === group;
  }
}

function offerGroupLabel(group: OfferGroup): string | null {
  switch (group) {
    case "all":
      return null;
    case "package":
      return "Precio del paquete";
    case "direct":
      return "Precios por kg";
    default:
      return unitPriceBasisLabel(group);
  }
}
