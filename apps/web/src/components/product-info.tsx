import type { ProductComparison } from "@comprafino/db";

export function packageSummary(
  product: Pick<ProductComparison, "quantityValue" | "quantityUnit" | "packageCount">,
): string {
  const unit = product.quantityUnit === "unit" ? "unidades" : product.quantityUnit;
  return `${product.quantityValue} ${unit}${product.packageCount > 1 ? ` · Pack ${product.packageCount}` : ""}`;
}
export function ObservedAt({ date }: { date: Date }) {
  const label = new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
  return (
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
      Observado <time dateTime={date.toISOString()}>{label}</time> (Perú)
    </p>
  );
}

export function RetailerBadge({ id, name }: { id: string; name: string }) {
  return (
    <span className="retailer-badge" data-retailer={id}>
      {name}
    </span>
  );
}
