import Link from "next/link";
import { formatPen, formatUnitPrice } from "@comprafino/db";
import type { GenericProductOffer, ProductComparison } from "@comprafino/db";
import { ProductImage } from "./product-image";
import { ObservedAt, packageSummary, RetailerBadge } from "./product-info";

export function GenericOfferCard({
  offer,
  benefits,
}: {
  offer: GenericProductOffer;
  benefits: boolean;
}) {
  return (
    <article data-offer-id={offer.id} className="product-card">
      <div className="product-summary">
        <a
          href={offer.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Ver ${offer.title} en ${offer.retailerName} (nueva pestaña)`}
          className="block min-w-0"
        >
          <ProductImage compact src={offer.imageUrl} name={offer.title} loading="lazy" />
        </a>
        <div className="min-w-0">
          <RetailerBadge id={offer.retailerId} name={offer.retailerName} />
          {offer.brand && <p className="mt-3 text-xs text-muted-foreground">{offer.brand}</p>}
          <h3 className="mt-1 text-base font-semibold leading-snug">{offer.title}</h3>
          {offer.quantity && offer.packageCount && (
            <p className="mt-2 text-xs text-muted-foreground">
              {packageSummary({
                quantityValue: offer.quantity.value,
                quantityUnit: offer.quantity.unit,
                packageCount: offer.packageCount,
              })}
            </p>
          )}
        </div>
      </div>
      <div className="card-price">
        <p className="text-3xl font-semibold tracking-tight text-primary tabular-nums">
          {formatPen(offer.currentPriceCents)}
          {offer.pricingBasis === "kg" ? " / kg" : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <p>Precio online para todos</p>
          {offer.regularPriceCents !== null && (
            <p>
              Antes <s>{formatPen(offer.regularPriceCents)}</s>
            </p>
          )}
        </div>
        {offer.unitPrice && offer.pricingBasis !== "kg" && (
          <p className="unit-price">
            {formatUnitPrice(offer.unitPrice)}
            {offer.ranking.condition ? " · con CMR" : ""}
            {offer.unitPrice.quality === "approximate" ? " · orientativo" : ""}
          </p>
        )}
        {offer.conditionalOffers.map((benefit) => (
          <div key={benefit.programKey} className="benefit-surface">
            <p className="text-sm font-semibold">
              Con CMR: {formatPen(benefit.priceCents)}
              {offer.pricingBasis === "kg" ? " / kg" : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{benefit.conditionLabel}</p>
          </div>
        ))}
      </div>
      <div className="card-footer">
        <ObservedAt date={offer.observedAt} />
        <a href={offer.url} target="_blank" rel="noopener noreferrer" className="card-link">
          Ver producto en {offer.retailerName}
          <span aria-hidden="true"> ↗</span>
          <span className="sr-only"> (nueva pestaña)</span>
        </a>
        {offer.canonicalId && (
          <Link
            href={`/products/${offer.canonicalId}${benefits ? "?priceMode=benefits" : ""}`}
            className="mt-3 block text-xs font-medium text-primary underline decoration-primary/30 underline-offset-4"
          >
            Comparar este producto en {offer.retailerCount} supermercados
          </Link>
        )}
      </div>
    </article>
  );
}

export function ExactProductCard({
  product,
  benefits,
  eager,
}: {
  product: ProductComparison;
  benefits: boolean;
  eager: boolean;
}) {
  const conditionalRanking = product.lowestBenefit;
  return (
    <article className="product-card">
      <Link
        href={`/products/${product.id}${benefits ? "?priceMode=benefits" : ""}`}
        className="group block rounded-xl"
      >
        <div className="product-summary">
          <ProductImage
            compact
            src={product.imageUrl}
            name={product.displayName}
            loading={eager ? "eager" : "lazy"}
          />
          <div className="min-w-0">
            <span className="comparison-badge">{product.retailerCount} supermercados</span>
            <p className="mt-3 text-xs text-muted-foreground">{product.brand}</p>
            <h3 className="mt-1 text-base font-semibold leading-snug group-hover:text-primary">
              {product.displayName}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">{packageSummary(product)}</p>
          </div>
        </div>
        <div className="card-price">
          {product.lowestPriceCents === null ? (
            <p className="text-sm text-muted-foreground">Estamos actualizando este producto.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Desde · para todos</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-primary tabular-nums">
                {formatPen(product.lowestPriceCents)}
              </p>
              <p className="mt-1 text-sm">{product.cheapestRetailers.join(" y ")}</p>
              {conditionalRanking && (
                <div className="benefit-surface">
                  <p className="text-sm font-semibold">
                    Con CMR: {formatPen(conditionalRanking.priceCents)}
                  </p>
                  <p className="mt-1 text-xs">
                    {conditionalRanking.retailers.join(" y ")} ·{" "}
                    {conditionalRanking.conditions.join(" · ")}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <p className="card-link">
          Ver comparación<span aria-hidden="true"> →</span>
        </p>
      </Link>
      <div className="mt-auto">
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
      </div>
    </article>
  );
}
