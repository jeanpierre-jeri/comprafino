import { ArrowRight, ArrowUpRight } from "@comprafino/ui";
import { NavigationLink } from "./navigation-link";
import { formatPen, formatUnitPrice } from "@comprafino/db";
import type { GenericProductOffer, ProductComparison } from "@comprafino/db";
import { ProductImage } from "./product-image";
import { ObservedAt, packageSummary, RetailerBadge } from "./product-info";

export function GenericOfferCard({
  offer,
  benefits,
  observedNow,
}: {
  observedNow: Date;
  offer: GenericProductOffer;
  benefits: boolean;
}) {
  return (
    <article data-offer-id={offer.id} className="product-card">
      <div className="product-summary">
        <ProductImage compact src={offer.imageUrl} name={offer.title} loading="lazy" />
        <div className="min-w-0">
          <h3 className="product-title">
            {offer.canonicalId ? (
              <NavigationLink
                className="product-title-link"
                href={`/products/${offer.canonicalId}${benefits ? "?priceMode=benefits" : ""}`}
              >
                {offer.title}
              </NavigationLink>
            ) : (
              <a
                className="product-title-link"
                href={offer.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {offer.title}
                <span className="sr-only"> (en {offer.retailerName}, nueva pestaña)</span>
              </a>
            )}
          </h3>
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
        <p className="card-amount">
          {formatPen(offer.currentPriceCents)}
          {offer.pricingBasis === "kg" ? " / kg" : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <p>Precio para todos</p>
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
        <div className="card-provenance">
          <RetailerBadge id={offer.retailerId} name={offer.retailerName} />
          <ObservedAt date={offer.observedAt} relativeTo={observedNow} />
        </div>
        <a href={offer.url} target="_blank" rel="noopener noreferrer" className="source-link">
          Ver producto en {offer.retailerName}
          <ArrowUpRight
            aria-hidden="true"
            size={14}
            className="ml-1 inline-block shrink-0 align-middle"
          />
          <span className="sr-only"> (nueva pestaña)</span>
        </a>
        {offer.canonicalId && (
          <NavigationLink
            href={`/products/${offer.canonicalId}${benefits ? "?priceMode=benefits" : ""}`}
            className="comparison-link"
          >
            Comparar este producto en {offer.retailerCount} supermercados
          </NavigationLink>
        )}
      </div>
    </article>
  );
}

export function ExactProductCard({
  product,
  benefits,
  eager,
  observedNow,
}: {
  product: ProductComparison;
  benefits: boolean;
  eager: boolean;
  observedNow: Date;
}) {
  const conditionalRanking = product.lowestBenefit;
  // One conservative freshness label for ordinary-price ties; detail keeps every timestamp.
  const observedAt = product.offers
    .filter(
      (offer) =>
        offer.freshness === "fresh" &&
        offer.available !== false &&
        offer.currentPriceCents === product.lowestPriceCents,
    )
    .reduce<Date | null>(
      (oldest, offer) => (!oldest || offer.observedAt < oldest ? offer.observedAt : oldest),
      null,
    );
  return (
    <article className="product-card exact-card">
      <NavigationLink
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
            <h3 className="product-title group-hover:text-primary">{product.displayName}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{packageSummary(product)}</p>
          </div>
        </div>
        <div className="card-price">
          {product.lowestPriceCents === null ? (
            <p className="text-sm text-muted-foreground">Estamos actualizando este producto.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Desde · para todos</p>
              <p className="mt-1 card-amount">{formatPen(product.lowestPriceCents)}</p>
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
        <p className="comparison-link">
          Comparar en {product.retailerCount} supermercados
          <ArrowRight
            aria-hidden="true"
            size={14}
            className="ml-1 inline-block shrink-0 align-middle"
          />
        </p>
      </NavigationLink>
      <div className="mt-auto">
        {observedAt && <ObservedAt date={observedAt} relativeTo={observedNow} />}
      </div>
    </article>
  );
}
