"use client";

import { Button } from "@comprafino/ui/components/button";
import { ArrowLeftRight, ShoppingBag } from "@comprafino/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@comprafino/ui/components/dialog";
import { defaultBasketLimit, formatPen } from "@comprafino/core";
import type { BasketPlan, ShoppingListItem } from "@comprafino/core";
import { CurrentOption } from "./current-shopping-option";

function Coverage({ plan, items }: { plan: BasketPlan; items: readonly ShoppingListItem[] }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
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

export type BasketPanel = { view: "comparison" | "purchases"; open: boolean };

export function BasketComparison({
  plans,
  items,
  selectedLimit,
  selectLimit,
  panel,
  onPanelChange,
}: {
  plans: readonly BasketPlan[];
  items: readonly ShoppingListItem[];
  selectedLimit: number | null;
  selectLimit: (limit: number) => void;
  panel: BasketPanel;
  onPanelChange: (panel: BasketPanel) => void;
}) {
  const selected = selectedLimit ?? defaultBasketLimit(plans);
  const plan = plans.find((p) => p.maxRetailers === selected);

  return (
    <Dialog
      open={panel.open}
      onOpenChange={(open) => {
        if (!open) {
          onPanelChange({ ...panel, open: false });
        }
      }}
    >
      <section aria-label="Comparación de canastas">
        {plan && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">Tu canasta hoy</h2>
              {plan.status === "complete" ? (
                <p className="mt-1 text-3xl font-semibold tracking-tight">
                  {formatPen(plan.totalCostCents)}
                </p>
              ) : (
                <Coverage plan={plan} items={items} />
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {plan.retailerIds
                  .map(
                    (id) =>
                      plan.assignments.find((assignment) => assignment.option.retailerId === id)!
                        .option.retailerName,
                  )
                  .join(" + ")}
                {plan.status === "complete" &&
                  ` · ${items.length} ${items.length === 1 ? "producto" : "productos"}`}
              </p>
            </div>
            {plan.assignments.some((assignment) => assignment.option.condition) && (
              <div className="benefit-surface text-sm">
                <p>
                  Precio potencial ·{" "}
                  {[
                    ...new Set(
                      plan.assignments.flatMap((assignment) =>
                        assignment.option.condition ? [assignment.option.condition] : [],
                      ),
                    ),
                  ].join(" · ")}
                </p>
                <p>
                  {plan.status === "complete"
                    ? "Para todos, esta selección"
                    : "Subtotal para todos, productos disponibles"}
                  : {formatPen(plan.ordinarySubtotalCents)}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="basket-controls mt-4">
          <DialogTrigger
            render={
              <Button
                variant="secondary"
                className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal sm:flex-none"
              />
            }
            onClick={() => onPanelChange({ view: "comparison", open: true })}
          >
            <ArrowLeftRight data-icon="inline-start" />
            Comparar supermercados
          </DialogTrigger>
          {plan && (
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal sm:flex-none"
                />
              }
              onClick={() => onPanelChange({ view: "purchases", open: true })}
            >
              <ShoppingBag data-icon="inline-start" />
              Ver compras por supermercado
            </DialogTrigger>
          )}
        </div>
      </section>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="pr-12">
          <DialogTitle>
            {panel.view === "comparison" ? "Comparar supermercados" : "Compras por supermercado"}
          </DialogTitle>
          <DialogDescription>
            {panel.view === "comparison"
              ? "Elige cuántas tiendas quieres visitar para esta compra."
              : "Productos y cantidades del plan seleccionado."}
          </DialogDescription>
        </DialogHeader>
        {panel.view === "comparison" && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
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
                  <Button
                    variant="outline"
                    className="mt-4 min-h-11"
                    aria-pressed={selected === p.maxRetailers}
                    onClick={() => {
                      selectLimit(p.maxRetailers);
                      onPanelChange({ view: "purchases", open: true });
                    }}
                  >
                    {selected === p.maxRetailers ? "Plan seleccionado" : "Ver compras"}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
        {panel.view === "purchases" && plan && (
          <div className="min-w-0">
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => onPanelChange({ view: "comparison", open: true })}
            >
              <ArrowLeftRight data-icon="inline-start" />
              Cambiar plan
            </Button>
            <section className="min-w-0" aria-label="Compras del plan seleccionado">
              <h3 className="sr-only">Compras por supermercado</h3>
              {plan.status === "incomplete" && <Coverage plan={plan} items={items} />}
              {plan.retailerIds.map((retailerId) => (
                <section key={retailerId} className="mt-4 rounded-xl border p-4">
                  <h4 className="font-semibold">
                    {
                      plan.assignments.find((a) => a.option.retailerId === retailerId)!.option
                        .retailerName
                    }
                  </h4>
                  <ul className="mt-3 flex flex-col gap-4">
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
