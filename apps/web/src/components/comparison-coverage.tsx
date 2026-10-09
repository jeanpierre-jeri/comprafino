import type { ProductComparison } from "@comprafino/db";

export function ComparisonCoverage({
  product,
}: {
  product: Pick<ProductComparison, "currentOfferCount">;
}) {
  const count = product.currentOfferCount;

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {count === 1 ? "1 oferta vigente" : `${count} ofertas vigentes`} · Verifica la disponibilidad.
    </p>
  );
}
