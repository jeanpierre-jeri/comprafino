import { UnitPriceReference } from "./unit-price-reference";
import { repriceUnitPrice, shoppingSeedForRetailerOffer } from "@comprafino/core";
import { AvailabilityNotice } from "./availability-notice";
import { AddShoppingItem } from "./shopping-list/shopping-item-editor";
import { ArrowUpRight } from "@comprafino/ui";
import { NavigationLink } from "./navigation-link";
import { formatPen } from "@comprafino/db";
import type { SearchProductResult } from "@comprafino/db";
import { ProductImage } from "./product-image";
import { ObservedAt, packageSummary, RetailerBadge } from "./product-info";
import { withSearchReturn } from "../lib/search-return";

export function SearchProductCard({
  product,
  benefits,
  observedNow,
  eager = false,
  returnTo,
}: {
  observedNow: Date;
  product: SearchProductResult;
  benefits: boolean;
  eager?: boolean;
  returnTo?: string;
}) {
  const offer = product.representative;
  const ordinary = product.ordinaryOffer;
  const ordinaryUnitPrice = repriceUnitPrice(
    ordinary.unitPrice,
    ordinary.ranking.priceCents,
    ordinary.currentPriceCents,
  );
  const href = withSearchReturn(
    product.canonicalId
      ? `/products/${product.canonicalId}${benefits ? "?priceMode=benefits" : ""}`
      : `/listings/${offer.id}`,
    returnTo,
  );
  const conditional = product.lowestBenefit;
  const condition = conditional?.benefit;

  return (
    <article data-product-id={product.id} data-offer-id={offer.id} className="product-card">
      <div className="product-summary">
        <ProductImage
          compact
          src={offer.imageUrl}
          name={offer.title}
          loading={eager ? "eager" : "lazy"}
        />
        <div className="min-w-0">
          <h3 className="product-title">
            <NavigationLink
              className="product-title-link"
              href={href}
              captureSearchReturn={Boolean(returnTo)}
            >
              {offer.title}
            </NavigationLink>
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
          Desde {formatPen(ordinary.currentPriceCents)}
          {offer.pricingBasis === "kg" ? " / kg" : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Precio para todos ·{" "}
          {product.cheapestOffers.map((member) => member.retailerName).join(", ")}
          {product.cheapestOffers.length > 1 ? " · Empate" : ""}
        </p>
        {!product.canonicalId && ordinary.regularPriceCents !== null && (
          <p className="text-xs text-muted-foreground">
            Antes <s>{formatPen(ordinary.regularPriceCents)}</s>
          </p>
        )}
        {offer.pricingBasis !== "kg" && (
          <UnitPriceReference
            price={ordinaryUnitPrice}
            family={ordinary.family.family}
            unavailableReason={ordinary.unitPriceUnavailableReason}
          />
        )}
        {condition && (
          <div className="benefit-surface">
            <p className="text-sm font-semibold">
              Con CMR: {formatPen(condition.priceCents)}
              {offer.pricingBasis === "kg" ? " / kg" : ""}
            </p>
            {offer.pricingBasis !== "kg" && (
              <UnitPriceReference
                conditional
                family={conditional?.offer.family.family}
                price={
                  conditional
                    ? repriceUnitPrice(
                        conditional.offer.unitPrice,
                        conditional.offer.ranking.priceCents,
                        conditional.benefit.priceCents,
                      )
                    : null
                }
              />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {condition.conditionLabel} ·{" "}
              {product.benefitTies.map((entry) => entry.offer.retailerName).join(", ")}
            </p>
          </div>
        )}
      </div>
      <div className="card-footer">
        <p className="text-sm font-semibold">
          {product.retailerCount} {product.retailerCount === 1 ? "supermercado" : "supermercados"} ·{" "}
          {product.offers.length}{" "}
          {product.offers.length === 1 ? "oferta de tienda" : "ofertas de tienda"}
        </p>
        <div className="flex flex-wrap gap-2">
          {product.offers.map((member) => (
            <RetailerBadge
              key={member.retailerId}
              id={member.retailerId}
              name={member.retailerName}
            />
          ))}
        </div>
        <ObservedAt date={ordinary.observedAt} relativeTo={observedNow} />
        <AvailabilityNotice
          available={product.offers.every((member) => member.available === true) ? true : null}
        />
        <NavigationLink
          href={href}
          captureSearchReturn={Boolean(returnTo)}
          className="comparison-link"
        >
          Comparar precios
        </NavigationLink>
        {!product.canonicalId && (
          <a href={offer.url} target="_blank" rel="noopener noreferrer" className="source-link">
            Ver producto en {offer.retailerName}
            <ArrowUpRight
              aria-hidden="true"
              size={14}
              className="ml-1 inline-block shrink-0 align-middle"
            />
            <span className="sr-only"> (nueva pestaña)</span>
          </a>
        )}
        <AddShoppingItem
          compact
          buttonLabel="Agregar a mi lista"
          seed={shoppingSeedForRetailerOffer({
            ...offer,
            // A shared card selects the confirmed product, not an arbitrary store SKU.
            id: product.canonicalId ? undefined : offer.id,
          })}
        />
      </div>
    </article>
  );
}
