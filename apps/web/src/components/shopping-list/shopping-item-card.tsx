"use client";

import type { Ref } from "react";
import { Button } from "@comprafino/ui/components/button";
import { shoppingSavingsNotice, shoppingFrequencyLabels } from "@comprafino/core";
import type { ShoppingListItem, ShoppingEvaluation, ShoppingSavingsNotice } from "@comprafino/core";
import { ShoppingSavingsMessage } from "./shopping-savings-notices";
import { CurrentOption } from "../current-shopping-option";

const intentLabels: Record<ShoppingListItem["intent"], string> = {
  generic: "Cualquier opción equivalente",
  preferred: "Producto preferido",
  strict: "Producto exacto",
};

function quantityLabel(item: ShoppingListItem): string {
  if (item.quantityMode === "packages") return item.quantity.amount === 1 ? "paquete" : "paquetes";

  return item.quantity.unit === "unit" ? "unidades" : item.quantity.unit;
}

type CardProps = {
  item: ShoppingListItem;
  result?: ShoppingEvaluation;
  pending: boolean;
  error: string;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
  editButtonRef: Ref<HTMLButtonElement>;
};

function CurrentItemOptions({
  item,
  result,
  pending,
  error,
  notice,
}: Pick<CardProps, "item" | "result" | "pending" | "error"> & {
  notice: ShoppingSavingsNotice | null;
}) {
  if (pending) return <p className="mt-4">Buscando opciones actuales…</p>;

  if (error) return <p className="mt-4">Precios no disponibles.</p>;

  if (item.intent === "preferred" && result?.alternative && !result.preferred) {
    return <p className="mt-4">Tu producto preferido no tiene un precio válido actual.</p>;
  }

  if (!result?.best || (item.intent === "preferred" && !result.preferred)) {
    return (
      <p className="mt-4">No encontramos alternativas suficientemente comparables por ahora.</p>
    );
  }

  return (
    <>
      <p className="sr-only">
        {item.intent === "preferred" && result.preferred
          ? "Tu producto preferido"
          : "Mejor opción actual"}
      </p>
      <CurrentOption option={result.best} compact>
        {notice && <ShoppingSavingsMessage notice={notice} />}
      </CurrentOption>
    </>
  );
}

export function ShoppingItemCard({
  item,
  result,
  pending,
  error,
  busy,
  onEdit,
  onRemove,
  editButtonRef,
}: CardProps) {
  const notice = !pending && !error && result ? shoppingSavingsNotice(item, result) : null;

  return (
    <article
      id={`shopping-item-${item.id}`}
      tabIndex={-1}
      className="scroll-mt-6 rounded-2xl border bg-surface p-4 sm:p-5"
      aria-label={item.label}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold wrap-anywhere">{item.label}</h3>
          <p className="mt-2 text-sm">
            {item.quantity.amount} {quantityLabel(item)} · {shoppingFrequencyLabels[item.frequency]}
          </p>
          {item.intent !== "generic" && (
            <p className="mt-1 text-sm text-muted-foreground">{intentLabels[item.intent]}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            className="min-h-11"
            ref={editButtonRef}
            disabled={busy}
            onClick={onEdit}
          >
            Editar<span className="sr-only"> {item.label}</span>
          </Button>
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onRemove}>
            Quitar<span className="sr-only"> {item.label}</span>
          </Button>
        </div>
      </div>
      <CurrentItemOptions
        item={item}
        result={result}
        pending={pending}
        error={error}
        notice={notice}
      />
      {!pending && !error && result?.alternative && (
        <aside className="benefit-surface mt-4">
          <p className="font-medium">Alternativa compatible hoy</p>
          <CurrentOption option={result.alternative} compact />
        </aside>
      )}
      {!pending && !error && item.intent !== "preferred" && result && result.options.length > 1 && (
        <details className="shopping-disclosure mt-3">
          <summary>
            {item.intent === "strict"
              ? "Otras tiendas del mismo producto"
              : "Otras opciones compatibles"}
          </summary>
          {result.options.slice(1).map((option) => (
            <CurrentOption key={option.id} option={option} />
          ))}
        </details>
      )}
    </article>
  );
}
