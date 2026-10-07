import { useId } from "react";
import { formatPen, shoppingSavingsNotice } from "@comprafino/core";
import type { ShoppingEvaluation, ShoppingListItem, ShoppingSavingsNotice } from "@comprafino/core";
import { Alert, AlertDescription, AlertTitle } from "@comprafino/ui/components/alert";

export function ShoppingSavingsSummary({
  items,
  evaluations,
  pending,
  error,
}: {
  items: readonly ShoppingListItem[];
  evaluations: readonly ShoppingEvaluation[];
  pending: boolean;
  error: string;
}) {
  const title = useId();
  if (pending || error) return null;

  const opportunities = items.flatMap((item) => {
    const evaluation = evaluations.find((result) => result.itemId === item.id);
    const notice = evaluation ? shoppingSavingsNotice(item, evaluation) : null;
    return notice ? [{ item, notice }] : [];
  });
  if (!opportunities.length) return null;

  return (
    <section aria-labelledby={title} className="mt-5">
      <Alert variant="savings" role="presentation">
        <AlertTitle id={title}>
          {opportunities.length === 1
            ? "Hay una oportunidad de ahorro hoy"
            : `Hay ${opportunities.length} oportunidades de ahorro hoy`}
        </AlertTitle>
        <AlertDescription>
          <p>
            Precios observados para la cantidad que necesitas. Revisa las condiciones de cada
            opción.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {opportunities.map(({ item, notice }) => (
              <li key={item.id}>
                <a
                  href={`#shopping-item-${item.id}`}
                  className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4"
                >
                  <span className="min-w-0 wrap-anywhere">
                    {item.label}: {formatPen(notice.savingsCents)} menos en{" "}
                    {notice.option.retailerName}
                    {notice.option.condition ? ` · ${notice.option.condition}` : ""}
                    {notice.baseline.condition &&
                    notice.baseline.condition !== notice.option.condition
                      ? ` · comparación con ${notice.baseline.condition}`
                      : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Son ahorros por producto; la comparación de canastas muestra el total por tiendas.
          </p>
        </AlertDescription>
      </Alert>
    </section>
  );
}

export function ShoppingSavingsMessage({ notice }: { notice: ShoppingSavingsNotice }) {
  let title;
  let comparison;

  if (notice.kind === "preferred-alternative") {
    title = "Una alternativa más barata hoy";
    comparison = "frente a tu producto preferido";
  } else if (notice.kind === "same-product") {
    title = "El mismo producto, más barato en otra tienda";
    comparison = `frente a ${notice.baseline.retailerName}`;
  } else {
    title = "Una opción compatible más barata hoy";
    comparison = `frente a otra opción compatible en ${notice.baseline.retailerName}`;
  }

  return (
    <Alert variant="savings" role="note" aria-label={title} className="mt-4">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>
          Ahorra {formatPen(notice.savingsCents)} en esta compra {comparison}.
        </p>
        <p className="mt-2">
          Opción más barata: {notice.option.retailerName} ·{" "}
          {formatPen(notice.option.totalCostCents)}.
        </p>
        {notice.option.condition && <p className="mt-2">{notice.option.condition}.</p>}
        {notice.baseline.condition && (
          <p className="mt-2">La opción comparada requiere: {notice.baseline.condition}.</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
