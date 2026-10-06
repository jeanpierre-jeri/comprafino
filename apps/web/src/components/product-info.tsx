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
  let relative;

  if (minutes === null || minutes < 0) {
    relative = null;
  } else if (minutes < 60) {
    if (minutes < 1) {
      relative = "hace menos de 1 min" as const;
    } else {
      relative = `hace ${minutes} min`;
    }
  } else if (minutes < 1440) {
    relative = `hace ${Math.floor(minutes / 60)} h`;
  } else {
    relative = `hace ${Math.floor(minutes / 1440)} d`;
  }

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
