"use client";

import { useId } from "react";
import { defaultBasketLimit, formatPen } from "@comprafino/core";
import type { BasketPlan, ShoppingListItem } from "@comprafino/core";
import { CurrentOption } from "./current-shopping-option";

function Coverage({ plan, items }: { plan: BasketPlan; items: readonly ShoppingListItem[] }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="font-semibold">
        Canasta incompleta · {plan.assignments.length} de {items.length} productos
      </p>
      <p>
        Subtotal de productos disponibles:{" "}
        <strong>{formatPen(plan.partialSubtotalCents ?? 0)}</strong>
      </p>
      <p className="text-sm">
        Faltan:{" "}
        {plan.missingItemIds.map((id) => items.find((i) => i.id === id)?.label ?? id).join(", ")}
      </p>
    </div>
  );
}

export function BasketComparison({
  plans,
  items,
  selectedLimit,
  selectLimit,
}: {
  plans: readonly BasketPlan[];
  items: readonly ShoppingListItem[];
  selectedLimit: number | null;
  selectLimit: (limit: number) => void;
}) {
  const detailsId = useId();
  const selected = selectedLimit ?? defaultBasketLimit(plans);
  const plan = plans.find((p) => p.maxRetailers === selected);

  return (
    <section aria-label="Comparación de canastas">
      <h2 className="text-xl font-semibold">Tu canasta hoy</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Comparamos las cantidades guardadas una vez, con productos exactos y alternativas
        compatibles.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {plans.map((p, index) => {
          const previous = plans[index - 1];
          const names = p.retailerIds.map(
            (id) => p.assignments.find((a) => a.option.retailerId === id)!.option.retailerName,
          );
          const conditions = [
            ...new Set(
              p.assignments.flatMap((a) => (a.option.condition ? [a.option.condition] : [])),
            ),
          ];

          return (
            <article
              key={p.maxRetailers}
              className="rounded-xl border p-4"
              aria-label={`Límite ${p.maxRetailers}`}
            >
              <p className="text-sm text-muted-foreground">
                {p.maxRetailers === 1
                  ? "Límite: 1 supermercado"
                  : `Límite: hasta ${p.maxRetailers} supermercados`}
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                {p.retailerIds.length
                  ? `${p.retailerIds.length} ${p.retailerIds.length === 1 ? "supermercado" : "supermercados"}`
                  : "Sin productos disponibles"}
              </h3>
              {names.length > 0 && <p>{names.join(" + ")}</p>}
              {p.status === "complete" ? (
                <>
                  <p className="mt-3 text-2xl font-semibold text-primary">
                    {formatPen(p.totalCostCents)}
                  </p>
                  <p className="text-sm">
                    Canasta completa · {items.length} de {items.length} productos
                  </p>
                  {p.marginalSavingsCents !== null && (
                    <p className="mt-2 text-sm">
                      {p.marginalSavingsCents === 0
                        ? "No ahorras más al añadir otra tienda."
                        : `${formatPen(p.marginalSavingsCents)} menos que ${previous?.maxRetailers === 1 ? "comprar todo en una tienda" : "usar hasta dos tiendas"}`}
                    </p>
                  )}
                  {previous?.status === "incomplete" && (
                    <p className="mt-2 text-sm">Este límite permite completar la canasta.</p>
                  )}
                </>
              ) : (
                <Coverage plan={p} items={items} />
              )}
              {p.status === "incomplete" &&
                previous?.status === "incomplete" &&
                p.assignments.length > previous.assignments.length && (
                  <p className="mt-2 text-sm">
                    Añadir otra tienda permite encontrar más productos de tu lista.
                  </p>
                )}
              {conditions.length > 0 && (
                <div className="benefit-surface mt-3 text-sm">
                  <p>Precio potencial · {conditions.join(" · ")}</p>
                  <p>
                    {p.status === "complete"
                      ? "Para todos, esta selección"
                      : "Subtotal para todos, productos disponibles"}
                    : {formatPen(p.ordinarySubtotalCents)}
                  </p>
                </div>
              )}
              <button
                className="shopping-button secondary mt-4"
                aria-pressed={selected === p.maxRetailers}
                aria-controls={detailsId}
                onClick={() => selectLimit(p.maxRetailers)}
              >
                {selected === p.maxRetailers ? "Plan seleccionado" : "Ver compras"}
              </button>
            </article>
          );
        })}
      </div>
      {plan && (
        <section id={detailsId} className="mt-6" aria-label="Compras del plan seleccionado">
          <h3 className="text-lg font-semibold">Compras por supermercado</h3>
          {plan.status === "incomplete" && <Coverage plan={plan} items={items} />}
          {plan.retailerIds.map((retailerId) => (
            <section key={retailerId} className="mt-4 rounded-xl border p-4">
              <h4 className="font-semibold">
                {
                  plan.assignments.find((a) => a.option.retailerId === retailerId)!.option
                    .retailerName
                }
              </h4>
              <ul className="mt-3 space-y-4">
                {plan.assignments
                  .filter((a) => a.option.retailerId === retailerId)
                  .map((a) => {
                    const item = items.find((i) => i.id === a.itemId)!;

                    return (
                      <li key={a.itemId}>
                        <p className="font-medium">{item.label}</p>
                        {item.intent === "preferred" &&
                          a.option.canonicalId !== item.canonicalId && (
                            <p className="text-sm text-primary">
                              Alternativa compatible a tu producto preferido
                            </p>
                          )}
                        <CurrentOption option={a.option} />
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </section>
      )}
    </section>
  );
}
