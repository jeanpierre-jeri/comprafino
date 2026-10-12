import Link from "next/link";
import { ArrowRight } from "@comprafino/ui";
import { unitPriceBases, unitPriceBasisLabel } from "@comprafino/core";
import type { UnitPriceBasis, ShoppingListItem } from "@comprafino/core";
import { maximumSearchLength, usefulSearchQuery } from "@comprafino/db";
import type { GenericProductOffer } from "@comprafino/db";
import type { SearchFilters } from "@comprafino/core/search-filters";
import { usefulSearchRequest } from "@comprafino/core";
import { PublicDataError } from "./public-shell";
import { GenericOfferCard } from "./offer-card";

type Props = {
  query: string;
  filters: SearchFilters;
  offers: GenericProductOffer[];
  failed: boolean;
  underlyingCount: number;
  observedNow: Date;
};

type OfferGroup = UnitPriceBasis | "unknown" | "package" | "direct" | "all";

export function SearchResultsContent({
  query,
  filters,
  offers,
  failed,
  underlyingCount,
  observedNow,
}: Props) {
  if (failed) return <PublicDataError />;

  if (!usefulSearchRequest(query, filters.category)) {
    return (
      <p className="empty-surface">
        Escribe entre 2 y {maximumSearchLength} caracteres para buscar un producto.
      </p>
    );
  }

  if (!offers.length) {
    if (filters.category) {
      return (
        <div className="empty-surface">
          <h2 className="text-xl font-semibold">
            No hay opciones con esta categoría y estos filtros.
          </h2>
          <p className="mt-2 text-muted-foreground">
            Nuestra cobertura sigue creciendo. Prueba otra categoría o busca en todas.
          </p>
          <Link
            href={usefulSearchQuery(query) ? `/search?q=${encodeURIComponent(query)}` : "/"}
            className="card-link"
          >
            {usefulSearchQuery(query) ? "Buscar en todas las categorías" : "Ver otras categorías"}
          </Link>
        </div>
      );
    }
    return (
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
          <ArrowRight
            aria-hidden="true"
            size={14}
            className="ml-1 inline-block shrink-0 align-middle"
          />
        </Link>
      </div>
    );
  }

  return (
    <section aria-label="Opciones en supermercados">
      <h2 className="text-2xl font-semibold tracking-tight">Productos</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Compara cantidades y precios. Las marcas, variedades y calidades pueden diferir.
      </p>
      {offers.some((offer) => offer.family.family === "toilet_paper") && (
        <p className="mt-2 text-sm text-muted-foreground">
          El precio por rollo es orientativo: el tamaño y la cantidad de hojas pueden variar.
        </p>
      )}
      {offers.some((offer) => offer.family.family === "canned_tuna") && (
        <p className="mt-2 text-sm text-muted-foreground">
          El peso del atún puede incluir líquido. No mostramos precio por kg sin distinguir peso
          neto y escurrido.
        </p>
      )}
      <p className="mt-2 mb-4 text-xs text-muted-foreground">
        {offers.length} productos en esta página
        {usefulSearchQuery(query) ? ` para «${query}»` : ""}
      </p>
      {offerGroups(filters.sort).map((group) => {
        const members = offers.filter(
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
                  <GenericOfferCard
                    offer={offer}
                    observedNow={observedNow}
                    benefits={filters.priceMode === "benefits"}
                    eager={offer.id === offers[0]?.id}
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

function offerMatchesGroup(offer: GenericProductOffer, group: OfferGroup): boolean {
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
