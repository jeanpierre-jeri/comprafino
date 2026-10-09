import { formatUnitPrice } from "@comprafino/core";
import type { ProductFamily, UnitPrice, UnitPriceResult } from "@comprafino/core";

export function UnitPriceReference({
  price,
  conditional = false,
  family = null,
  unavailableReason = null,
}: {
  price: UnitPrice | null;
  conditional?: boolean;
  family?: ProductFamily | null;
  unavailableReason?: UnitPriceResult["reason"];
}) {
  if (!price) {
    if (!unavailableReason) return null;

    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {unitPriceUnavailableMessage(unavailableReason)}
      </p>
    );
  }

  return (
    <p className="mt-1 text-sm font-semibold">
      {formatUnitPrice(price, family)}
      {conditional ? " · con CMR" : ""}
      {price.quality === "approximate" ? " · orientativo" : ""}
    </p>
  );
}

function unitPriceUnavailableMessage(reason: NonNullable<UnitPriceResult["reason"]>): string {
  switch (reason) {
    case "missing-quantity":
      return "Sin precio por unidad: la cantidad no está indicada.";
    case "ambiguous-quantity":
    case "invalid-quantity":
    case "conflicting-dimensions":
      return "Sin precio por unidad: la cantidad no es suficientemente clara.";
    case "ambiguous-semantics":
      return "Sin precio por unidad: el contenido no permite una comparación confiable.";
    case "not-fresh":
      return "Sin precio por unidad vigente: el precio requiere actualización.";
    case "unavailable":
      return "Sin precio por unidad vigente: no hay una oferta de compra vigente.";
    case "invalid-price":
      return "Sin precio por unidad: no hay un precio válido para calcularlo.";
    default: {
      const unexpectedReason: never = reason;
      throw new Error("Unsupported unit-price reason", { cause: unexpectedReason });
    }
  }
}
