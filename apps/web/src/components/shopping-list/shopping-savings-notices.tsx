import { useId } from "react";
import { formatPen, shoppingSavingsNotice } from "@comprafino/core";
import type { ShoppingEvaluation, ShoppingListItem, ShoppingSavingsNotice } from "@comprafino/core";
import { Button } from "@comprafino/ui/components/button";
import { ChevronDown } from "@comprafino/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@comprafino/ui/components/collapsible";
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
    <section aria-labelledby={title} className="mt-3">
      <Collapsible>
        <Alert variant="savings" role="presentation">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <AlertTitle id={title}>
              {opportunities.length === 1
                ? "Hay una oportunidad de ahorro hoy"
                : `Hay ${opportunities.length} oportunidades de ahorro hoy`}
            </AlertTitle>
            <CollapsibleTrigger render={<Button variant="ghost" className="group min-h-11" />}>
              Ver ahorros
              <ChevronDown
                data-icon="inline-end"
                aria-hidden="true"
                className="transition-transform group-aria-expanded:rotate-180"
              />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent keepMounted>
            <div className="pt-2">
              <AlertDescription>
                <ul className="flex flex-col gap-2">
                  {opportunities.map(({ item, notice }) => (
                    <li key={item.id}>
                      <a
                        href={`#shopping-item-${item.id}`}
                        onClick={() => {
                          const card = document.getElementById(`shopping-item-${item.id}`);
                          const trigger = card?.querySelector<HTMLButtonElement>(
                            "[data-shopping-details-trigger]",
                          );
                          if (trigger?.getAttribute("aria-expanded") === "false") {
                            trigger.click();
                          }
                          card?.focus({ preventScroll: true });
                        }}
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
              </AlertDescription>
            </div>
          </CollapsibleContent>
        </Alert>
      </Collapsible>
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

        {notice.option.condition && <p className="mt-2">{notice.option.condition}.</p>}
        {notice.baseline.condition && (
          <p className="mt-2">La opción comparada requiere: {notice.baseline.condition}.</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
