import { logDiagnostic } from "../../../server/diagnostics.ts";
import type { Metadata } from "next";
import { cache } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { parseHistoryRange, shoppingSeedForRetailerOffer } from "@comprafino/core";
import type { HistoryRange } from "@comprafino/core";
import {
  createDatabase,
  formatPen,
  formatUnitPrice,
  getPublicRetailerListingDetail,
  isPublicProductId,
} from "@comprafino/db";
import { AddShoppingItem } from "../../../components/shopping-list/shopping-item-editor";
import { PriceHistoryPresentation } from "../../../components/price-history";
import { ProductImage } from "../../../components/product-image";
import { ObservedAt, packageSummary, RetailerBadge } from "../../../components/product-info";
import { PriceNotice, PublicDataError, PublicShell } from "../../../components/public-shell";

const loadListing = cache(async (id: string, range: HistoryRange) => {
  if (!isPublicProductId(id)) return { listing: null, failed: false };

  await connection();

  try {
    return {
      listing: await getPublicRetailerListingDetail(createDatabase(), id, { range }),
      failed: false,
    };
  } catch (error) {
    logDiagnostic(error, { stage: "public", operation: "listing", reason: "db_read_failed" });

    return { listing: null, failed: true };
  }
});

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { listing } = await loadListing(
    (await params).id,
    parseHistoryRange((await searchParams).range),
  );

  return {
    title: listing ? `${listing.title} - precio e historial | CompraFino` : "Producto | CompraFino",
    description: listing
      ? `Precio e historial observado de ${listing.title} en ${listing.retailerName}. Precios para todos y beneficios separados.`
      : undefined,
  };
}

export default async function ListingPage({ params, searchParams }: Props) {
  const range = parseHistoryRange((await searchParams).range);
  const { listing, failed } = await loadListing((await params).id, range);

  if (failed) {
    return (
      <PublicShell>
        <h1 className="mb-6 text-3xl font-semibold">Detalle del producto</h1>
        <PublicDataError />
      </PublicShell>
    );
  }

  if (!listing) {
    notFound();
  }

  return (
    <PublicShell>
      <Link
        href="/search"
        className="text-sm font-medium text-primary underline underline-offset-4"
      >
        Buscar otro producto
      </Link>
      <div className="detail-hero">
        <ProductImage src={listing.imageUrl} name={listing.title} loading="eager" />
        <div>
          <p className="eyebrow">Este producto en {listing.retailerName}</p>
          <p className="mt-2 text-xs text-muted-foreground">{listing.brand}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {listing.title}
          </h1>
          {listing.quantity && listing.packageCount && (
            <p className="mt-3 text-sm text-muted-foreground">
              {packageSummary({
                quantityValue: listing.quantity.value,
                quantityUnit: listing.quantity.unit,
                packageCount: listing.packageCount,
              })}
            </p>
          )}
          <div className="detail-best-price">
            <RetailerBadge id={listing.retailerId} name={listing.retailerName} />
            <p className="mt-3 text-sm font-medium">
              {listingPriceLabel(listing.current, listing.historicalOnly)}
            </p>
            <p className="mt-2 text-4xl font-semibold tracking-tight text-primary tabular-nums">
              {formatPen(listing.currentPriceCents)}
              {listing.pricingBasis === "kg" ? " / kg" : ""}
            </p>
            {listing.regularPriceCents !== null && (
              <p className="mt-2 text-sm text-muted-foreground">
                Referencia registrada <s>{formatPen(listing.regularPriceCents)}</s>
              </p>
            )}
            {listing.unitPrice && (
              <p className="unit-price">
                {formatUnitPrice(listing.unitPrice)}
                {listing.unitPrice.quality === "approximate" ? " · orientativo" : ""}
              </p>
            )}
            {listing.available === false && (
              <p className="mt-2 text-sm text-muted-foreground">
                No disponible en la última consulta.
              </p>
            )}
            {listing.available !== false && (
              <p className="mt-2 text-sm text-muted-foreground">
                {listing.available === true
                  ? "Disponible en la última consulta."
                  : "Disponibilidad no confirmada."}
              </p>
            )}
            {!listing.current && (
              <p className="mt-2 text-sm text-muted-foreground">
                Este registro no confirma el precio de compra de hoy.
              </p>
            )}
            <ObservedAt date={listing.observedAt} />
          </div>
          {listing.conditionalOffers.map((benefit) => (
            <aside key={benefit.programKey} className="benefit-surface">
              <p className="font-semibold">
                {formatPen(benefit.priceCents)} con CMR
                {listing.pricingBasis === "kg" ? " / kg" : ""}
              </p>
              <p className="text-xs text-muted-foreground">{benefit.conditionLabel}</p>
            </aside>
          ))}
        </div>
      </div>
      <AddShoppingItem
        buttonLabel="Agregar a mi lista"
        seed={shoppingSeedForRetailerOffer(listing)}
      />
      <PriceHistoryPresentation
        history={listing.history}
        range={range}
        path={`/listings/${listing.id}`}
      />
      {listing.canonicalId && (
        <p className="mt-6">
          <Link className="card-link" href={`/products/${listing.canonicalId}`}>
            Comparar este producto entre supermercados
          </Link>
        </p>
      )}
      <p className="mt-6">
        <a className="card-link" href={listing.url} target="_blank" rel="noopener noreferrer">
          Ver producto en {listing.retailerName}
          <span className="sr-only"> (abre una nueva pestaña)</span>
        </a>
      </p>
      <PriceNotice />
    </PublicShell>
  );
}

function listingPriceLabel(current: boolean, historicalOnly: boolean): string {
  if (current) return "Precio online para todos";

  return historicalOnly
    ? "Último precio histórico registrado"
    : "Último precio registrado · pendiente de actualización";
}
