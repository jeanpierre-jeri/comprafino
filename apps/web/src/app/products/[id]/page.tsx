import type { Metadata } from "next";
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
} from "@comprafino/db";
import { ProductImage } from "../../../components/product-image";
import { ObservedAt, packageSummary } from "../../../components/product-info";
import { PriceNotice, PublicDataError, PublicShell } from "../../../components/public-shell";

// React cache deduplicates metadata/page reads within this request only.
const loadProduct = cache(async (id: string) => {
  if (!isPublicProductId(id)) return { product: null, failed: false };
  await connection();
  try {
    return { product: await getCanonicalProductComparison(createDatabase(), id), failed: false };
  } catch (error) {
    console.error("Public comparison database query failed", error);
    return { product: null, failed: true };
  }
});
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { product } = await loadProduct((await params).id);
  return {
    title: product
      ? `${product.displayName} – precios | CompraFino`
      : "Comparar precios | CompraFino",
  };
}
export default async function ProductPage({ params }: Props) {
  const { product, failed } = await loadProduct((await params).id);
  if (failed)
    return (
      <PublicShell>
        <h1 className="mb-6 text-3xl font-semibold">Comparar precios</h1>
        <PublicDataError />
      </PublicShell>
    );
  if (!product) notFound();
  return (
    <PublicShell>
      <Link href="/search" className="text-sm text-primary underline">
        Buscar otro producto
      </Link>
      <div className="mt-7 grid items-start gap-8 sm:grid-cols-[256px_1fr]">
        <ProductImage
          key={product.imageUrl ?? product.id}
          src={product.imageUrl}
          name={product.displayName}
        />
        <div>
          <p className="text-sm text-muted-foreground">{product.brand}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {product.displayName}
          </h1>
          <p className="mt-4 text-muted-foreground">{packageSummary(product)}</p>
          <div className="mt-6 rounded-xl bg-primary/5 p-5">
            {product.lowestPriceCents === null ? (
              <p className="text-sm text-muted-foreground">Estamos actualizando este producto.</p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  Mejor precio observado{product.cheapestRetailers.length > 1 ? " · Empate" : ""}
                </p>
                <p className="mt-2 text-3xl font-semibold text-primary">
                  {formatPen(product.lowestPriceCents)}
                </p>
                <p className="mt-2">{product.cheapestRetailers.join(" y ")}</p>
              </>
            )}
          </div>
        </div>
      </div>
      <section className="mt-12" aria-labelledby="offers-title">
        <h2 id="offers-title" className="text-xl font-semibold">
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
                <article
                  className={`flex flex-col gap-5 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between ${best ? "border-primary/40 bg-primary/5" : ""}`}
                >
                  <div>
                    <h3 className="text-lg font-semibold">{offer.retailerName}</h3>
                    {best && (
                      <p className="mt-1 text-sm font-medium text-primary">
                        {product.cheapestRetailers.length > 1
                          ? "Mejor precio compartido"
                          : "Mejor precio observado"}
                      </p>
                    )}
                    <ObservedAt date={offer.observedAt} />
                    {offer.available === false ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No disponible en la última consulta.
                      </p>
                    ) : offer.freshness === "stale" ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Precio pendiente de actualización.
                      </p>
                    ) : offer.freshness === "too-stale" ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Último precio registrado · pendiente de actualización.
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:text-right">
                    <p className="text-2xl font-semibold">{formatPen(offer.currentPriceCents)}</p>
                    {offer.regularPriceCents !== null && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Antes <s>{formatPen(offer.regularPriceCents)}</s>
                      </p>
                    )}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-block rounded text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                      >
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
      <PriceNotice />
    </PublicShell>
  );
}
