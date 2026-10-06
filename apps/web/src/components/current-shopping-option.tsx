import Link from "next/link";
import { formatPen } from "@comprafino/core";
import type { ShoppingOption } from "@comprafino/core";

export function CurrentOption({ option }: { option: ShoppingOption }) {
  let measure;

  if (option.countsPackages) {
    measure = "paquetes" as const;
  } else if (option.quantityUnit === "unit") {
    measure = "unidades" as const;
  } else {
    measure = option.quantityUnit;
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="font-medium">{option.title}</p>
      <p>
        {option.retailerName} · <strong>{formatPen(option.totalCostCents)}</strong>
      </p>
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
}
