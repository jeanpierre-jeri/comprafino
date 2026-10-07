import { UnitPriceReference } from "../../../components/unit-price-reference";
import type { RetailerOffer } from "@comprafino/db";
import { canonicalUnitPrice } from "@comprafino/core";
import { AvailabilityNotice } from "../../../components/availability-notice";
import { catalogQuantityToShoppingUnit } from "@comprafino/core";
import { logDiagnostic } from "../../../server/diagnostics.ts";
import { AddShoppingItem } from "../../../components/shopping-list/shopping-item-editor";
import { shoppingQueryForTitle } from "@comprafino/core";
import type { Metadata } from "next";
import { parseHistoryRange } from "@comprafino/core";
import { PriceHistory } from "../../../components/price-history";
import { cache } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  createDatabase,
  formatPen,
  getCanonicalProductComparison,
  isPublicProductId,
  retailerProductUrl,
  searchFilters,
} from "@comprafino/db";
import { SearchControls } from "../../../components/search-controls";
import { ProductImage } from "../../../components/product-image";
import { ObservedAt, packageSummary, RetailerBadge } from "../../../components/product-info";
import { PriceNotice, PublicDataError, PublicShell } from "../../../components/public-shell";

// React cache deduplicates metadata/page reads within this request only.
const loadProduct = cache(async (id: string, mode: "standard" | "benefits" = "standard") => {
  if (!isPublicProductId(id)) return { product: null, failed: false };

  await connection();

  try {
    const observedNow = new Date();

    return {
      observedNow,
      product: await getCanonicalProductComparison(createDatabase(), id, observedNow, mode),
      failed: false,
    };
  } catch (error) {
    logDiagnostic(error, { stage: "public", operation: "comparison", reason: "db_read_failed" });

    return { product: null, failed: true };
  }
});

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { product } = await loadProduct((await params).id);

  return {
    title: product
      ? `${product.displayName} – precios | CompraFino`
      : "Comparar precios | CompraFino",
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const query = await searchParams;
  const filters = searchFilters(query);
  const range = parseHistoryRange(query.range);
  const { product, failed, observedNow } = await loadProduct((await params).id, filters.priceMode);

  if (failed) {
    return (
      <PublicShell>
        <h1 className="mb-6 text-3xl font-semibold">Comparar precios</h1>
        <PublicDataError />
      </PublicShell>
    );
  }

  if (!product) {
    notFound();
  }

  const packageContents = {
    quantityValue: product.quantityValue,
    quantityUnit: product.quantityUnit,
    packageCount: product.packageCount,
  };

  function pricePerUnit(priceCents: number, source: RetailerOffer) {
    return canonicalUnitPrice(
      {
        title: source.title,
        ...packageContents,
        priceCents,
        observedAt: source.observedAt,
        available: source.available,
      },
      observedNow,
    );
  }

  const benefitSource = product.offers.find((offer) =>
    offer.conditionalOffers.some(
      (benefit) => benefit.priceCents === product.lowestBenefit?.priceCents,
    ),
  );

  return (
    <PublicShell>
      <Link
        href="/search"
        className="text-sm font-medium text-primary underline underline-offset-4"
      >
        Buscar otro producto
      </Link>
      <div className="detail-hero">
        <ProductImage
          key={product.imageUrl ?? product.id}
          src={product.imageUrl}
          name={product.displayName}
          loading="eager"
        />
        <div>
          <p className="eyebrow">El mismo producto, tienda por tienda</p>
          <p className="mt-2 text-xs text-muted-foreground">{product.brand}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {product.displayName}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">{packageSummary(product)}</p>
          <div className="detail-best-price">
            {product.lowestPriceCents === null ? (
              <p className="text-sm text-muted-foreground">Estamos actualizando este producto.</p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  Mejor precio para todos
                  {product.cheapestRetailers.length > 1 ? " · Empate" : ""}
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-tight text-primary tabular-nums">
                  {formatPen(product.lowestPriceCents)}
                </p>
                <p className="mt-2">{product.cheapestRetailers.join(" y ")}</p>
              </>
            )}
          </div>
          {product.lowestBenefit &&
            product.lowestBenefit.priceCents < (product.lowestPriceCents ?? Infinity) && (
              <aside className="benefit-surface">
                <p className="text-sm font-medium">Con tarjeta CMR</p>
                <p className="mt-1 text-lg font-semibold">
                  {formatPen(product.lowestBenefit.priceCents)} con CMR
                </p>
                <UnitPriceReference
                  conditional
                  price={
                    benefitSource
                      ? pricePerUnit(product.lowestBenefit.priceCents, benefitSource)
                      : null
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {product.lowestBenefit.retailers.join(" y ")} ·{" "}
                  {product.lowestBenefit.conditions.join(" · ")}
                </p>
              </aside>
            )}
        </div>
      </div>
      <AddShoppingItem
        seed={{
          label: product.displayName,
          query: shoppingQueryForTitle(product.displayName),
          canonicalId: product.id,
          quantity: {
            amount:
              (product.quantityValue * product.packageCount) /
              (product.quantityUnit === "unit" ? 1 : 1000),
            unit: catalogQuantityToShoppingUnit(product.quantityUnit),
          },
        }}
      />
      <SearchControls query="" filters={filters} comparisonPath={`/products/${product.id}`} />
      <section className="mt-8" aria-labelledby="offers-title">
        <h2 id="offers-title" className="text-2xl font-semibold tracking-tight">
          Compara en {product.retailerCount} supermercados
        </h2>
        <ul className="mt-5 space-y-4">
          {product.offers.map((offer) => {
            const best =
              offer.freshness === "fresh" &&
              offer.available !== false &&
              offer.currentPriceCents === product.lowestPriceCents;
            const url = retailerProductUrl(offer);

            return (
              <li key={offer.retailerId}>
                <article className={`comparison-row ${best ? "best-offer" : ""}`}>
                  <div>
                    <h3>
                      <RetailerBadge id={offer.retailerId} name={offer.retailerName} />
                    </h3>
                    {best && (
                      <p className="mt-1 text-sm font-medium text-primary">
                        {product.cheapestRetailers.length > 1
                          ? "Mejor precio compartido"
                          : "Mejor precio para todos"}
                      </p>
                    )}
                    <ObservedAt date={offer.observedAt} />
                    <AvailabilityNotice available={offer.available ?? null} />
                    <PriceFreshnessNotice freshness={offer.freshness} />
                  </div>
                  <div className="sm:text-right">
                    <p
                      className={`text-3xl font-semibold tracking-tight tabular-nums ${best ? "text-primary" : ""}`}
                    >
                      {formatPen(offer.currentPriceCents)}
                    </p>
                    <p className="text-xs text-muted-foreground">Precio online para todos</p>
                    {offer.regularPriceCents !== null && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Antes <s>{formatPen(offer.regularPriceCents)}</s>
                      </p>
                    )}
                    {offer.conditionalOffers.map((benefit) => (
                      <div key={benefit.programKey} className="benefit-surface">
                        <p className="font-semibold">{formatPen(benefit.priceCents)} con CMR</p>
                        <UnitPriceReference
                          conditional
                          price={pricePerUnit(benefit.priceCents, offer)}
                        />
                        <p className="text-xs">{benefit.conditionLabel}</p>
                      </div>
                    ))}
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="card-link">
                        Ver producto en {offer.retailerName}
                        <span className="sr-only"> (abre una nueva pestaña)</span>
                      </a>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </section>
      <PriceHistory
        productId={product.id}
        range={range}
        benefits={filters.priceMode === "benefits"}
      />
      <PriceNotice />
    </PublicShell>
  );
}

function PriceFreshnessNotice({ freshness }: { freshness: string }) {
  if (freshness === "stale") {
    return <p className="mt-1 text-sm text-muted-foreground">Precio pendiente de actualización.</p>;
  }

  if (freshness === "too-stale") {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        Último precio registrado · pendiente de actualización.
      </p>
    );
  }

  return null;
}
