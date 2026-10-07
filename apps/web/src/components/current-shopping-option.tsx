import { AvailabilityNotice } from "./availability-notice";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatPen } from "@comprafino/core";
import type { ShoppingOption } from "@comprafino/core";

export function CurrentOption({
  option,
  compact = false,
  children,
}: {
  option: ShoppingOption;
  compact?: boolean;
  children?: ReactNode;
}) {
  let measure;

  if (option.countsPackages) {
    measure = "paquetes" as const;
  } else if (option.quantityUnit === "unit") {
    measure = "unidades" as const;
  } else {
    measure = option.quantityUnit;
  }

  const details = (
    <div className="mt-3 flex flex-col gap-2">
      <p className="font-medium wrap-anywhere">{option.title}</p>
      {children}
      <p className="text-sm">
        {option.packages} {option.packages === 1 ? "paquete" : "paquetes"} ·{" "}
        {option.purchasedQuantity} {measure} en total
        {option.overbuy > 0 ? ` · ${option.overbuy} ${measure} de más` : ""}
      </p>
      <p className="text-sm text-muted-foreground">
        {formatPen(Math.round(option.effectiveUnitCents))} / {measure} ·{" "}
        {option.condition ?? "Precio para todos"}
      </p>

      {option.condition && (
        <p className="text-sm">
          Para todos: {formatPen(option.ordinaryTotalCents)} por esta compra.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <a className="card-link" href={option.url} target="_blank" rel="noopener noreferrer">
          Ver en {option.retailerName}
          <span className="sr-only"> (abre una nueva pestaña)</span>
        </a>
        {option.canonicalId && (
          <Link className="card-link" href={`/products/${option.canonicalId}`}>
            Comparar e historial
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="mt-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-muted-foreground">{option.retailerName}</span>
        <strong className="text-lg tabular-nums">{formatPen(option.totalCostCents)}</strong>
      </p>
      {option.condition && compact && (
        <p className="mt-1 text-sm text-primary">Precio potencial · {option.condition}</p>
      )}
      {option.condition && compact && (
        <p className="mt-1 text-sm text-muted-foreground">
          Para todos: {formatPen(option.ordinaryTotalCents)}
        </p>
      )}
      <AvailabilityNotice available={option.available} />
      {compact ? (
        <details className="shopping-disclosure mt-3">
          <summary>Ver producto y precio</summary>
          {details}
        </details>
      ) : (
        details
      )}
    </div>
  );
}
