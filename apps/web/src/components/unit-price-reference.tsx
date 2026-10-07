import { formatUnitPrice } from "@comprafino/core";
import type { UnitPrice } from "@comprafino/core";

export function UnitPriceReference({
  price,
  conditional = false,
}: {
  price: UnitPrice | null;
  conditional?: boolean;
}) {
  if (!price) return null;

  return (
    <p className="mt-1 text-sm font-semibold">
      {formatUnitPrice(price)}
      {conditional ? " · con CMR" : ""}
      {price.quality === "approximate" ? " · orientativo" : ""}
    </p>
  );
}
