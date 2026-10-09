import { ExactComparisonDisclosure } from "./exact-comparison-disclosure";
import Link from "next/link";
import { ArrowRight } from "@comprafino/ui";
import { unitPriceBases, unitPriceBasisLabel } from "@comprafino/core";
import type { UnitPriceBasis, ShoppingListItem } from "@comprafino/core";
import { maximumSearchLength, usefulSearchQuery } from "@comprafino/db";
import type { ProductComparison, GenericProductOffer } from "@comprafino/db";
import type { SearchFilters } from "@comprafino/core/search-filters";
import { PublicDataError } from "./public-shell";
import { ExactProductCard, GenericOfferCard } from "./offer-card";

type Props = {
  query: string;
  filters: SearchFilters;
  products: ProductComparison[];
  offers: GenericProductOffer[];
  failed: boolean;
  underlyingCount: number;
  observedNow: Date;
};

type OfferGroup = UnitPriceBasis | "unknown" | "package" | "direct" | "all";

export function SearchResultsContent({
  query,
  filters,
  products,
  offers,
  failed,
  underlyingCount,
  observedNow,
}: Props) {
  if (failed) return <PublicDataError />;

  if (!usefulSearchQuery(query)) {
    return (
      <p className="empty-surface">
        Escribe entre 2 y {maximumSearchLength} caracteres para buscar un producto.
      </p>
    );
  }

  if (!products.length && !offers.length) {
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
    <>
      {products.length > 0 && (
        <section className="exact-section" aria-label="Comparaciones del mismo producto">
          <p className="eyebrow">Entre supermercados</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Compara el mismo producto</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Comparaciones por relevancia entre todas las tiendas con registros. El precio «Desde»
            considera sus ofertas vigentes, aunque selecciones un supermercado.
          </p>
          <p className="mt-2 mb-4 text-xs text-muted-foreground">
            {products.length === 20 ? "Hasta 20" : products.length} productos para «{query}»
          </p>
          {products.length > 3 ? (
            <ExactComparisonDisclosure
              remainingCount={products.length - 3}
              preview={
                <ExactProductGrid
                  products={products.slice(0, 3)}
                  benefits={filters.priceMode === "benefits"}
                  observedNow={observedNow}
                  eagerFirst
                />
              }
            >
              <ExactProductGrid
                products={products.slice(3)}
                benefits={filters.priceMode === "benefits"}
                observedNow={observedNow}
              />
            </ExactComparisonDisclosure>
          ) : (
            <ExactProductGrid
              products={products}
              benefits={filters.priceMode === "benefits"}
              observedNow={observedNow}
              eagerFirst
            />
          )}
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
            {offers.length === 30 ? "Hasta 30" : offers.length} ofertas para «{query}»
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
  );
}

function ExactProductGrid({
  products,
  benefits,
  observedNow,
  eagerFirst = false,
}: {
  products: readonly ProductComparison[];
  benefits: boolean;
  observedNow: Date;
  eagerFirst?: boolean;
}) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product, index) => (
        <li key={product.id}>
          <ExactProductCard
            product={product}
            benefits={benefits}
            eager={eagerFirst && index === 0}
            observedNow={observedNow}
          />
        </li>
      ))}
    </ul>
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
