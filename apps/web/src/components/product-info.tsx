import type { ProductComparison } from "@comprafino/db";

export function packageSummary(
  product: Pick<ProductComparison, "quantityValue" | "quantityUnit" | "packageCount">,
): string {
  const unit = product.quantityUnit === "unit" ? "unidades" : product.quantityUnit;
  return `${product.quantityValue} ${unit}${product.packageCount > 1 ? ` · Pack ${product.packageCount}` : ""}`;
}
export function ObservedAt({ date, relativeTo }: { date: Date; relativeTo?: Date }) {
  const label = new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
  // Request-time display only; the exact source observation remains in datetime/title.
  const minutes = relativeTo ? Math.floor((relativeTo.getTime() - date.getTime()) / 60_000) : null;
  const relative =
    minutes === null || minutes < 0
      ? null
      : minutes < 60
        ? minutes < 1
          ? "hace menos de 1 min"
          : `hace ${minutes} min`
        : minutes < 1440
          ? `hace ${Math.floor(minutes / 60)} h`
          : `hace ${Math.floor(minutes / 1440)} d`;
  return (
    <p className={relative ? "freshness" : "mt-2 text-xs leading-relaxed text-muted-foreground"}>
      Observado{" "}
      <time dateTime={date.toISOString()} title={`${label} (Perú)`}>
        {relative ?? label}
      </time>
      {relative ? "" : " (Perú)"}
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
