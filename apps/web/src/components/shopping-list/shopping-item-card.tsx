"use client";

import type { Ref } from "react";
import { formatPen, shoppingFrequencyLabels } from "@comprafino/core";
import type { ShoppingListItem, ShoppingEvaluation } from "@comprafino/core";
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
}: Pick<CardProps, "item" | "result" | "pending" | "error">) {
  if (pending) return <p className="mt-4">Buscando opciones actuales…</p>;

  if (error) return <p className="mt-4">Precios no disponibles.</p>;

  if (!result?.best || (item.intent === "preferred" && !result.preferred)) {
    return (
      <p className="mt-4">No encontramos alternativas suficientemente comparables por ahora.</p>
    );
  }

  return (
    <>
      <p className="mt-4 text-sm font-medium">
        {item.intent === "preferred" && result.preferred
          ? "Tu producto preferido"
          : "Mejor opción actual"}
      </p>
      <CurrentOption option={result.best} />
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
  return (
    <article className="empty-surface h-full" aria-label={item.label}>
      <h3 className="text-xl font-semibold wrap-break-word">{item.label}</h3>
      <p className="mt-2 text-sm">
        {item.quantity.amount} {quantityLabel(item)} · {shoppingFrequencyLabels[item.frequency]}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{intentLabels[item.intent]}</p>
      <CurrentItemOptions item={item} result={result} pending={pending} error={error} />
      {!pending && !error && result?.alternative && (
        <aside className="benefit-surface mt-4">
          <p className="font-medium">Alternativa compatible hoy</p>
          {result.savingsCents > 0 && (
            <p>Ahorra {formatPen(result.savingsCents)} en esta compra.</p>
          )}
          {!result.preferred && (
            <p className="text-sm">Tu producto preferido no tiene un precio válido actual.</p>
          )}
          <CurrentOption option={result.alternative} />
        </aside>
      )}
      {!pending && !error && item.intent !== "preferred" && result && result.options.length > 1 && (
        <details className="mt-4">
          <summary className="cursor-pointer">
            {item.intent === "strict"
              ? "Otras tiendas del mismo producto"
              : "Otras opciones compatibles"}
          </summary>
          {result.options.slice(1).map((option) => (
            <CurrentOption key={option.id} option={option} />
          ))}
        </details>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="shopping-button secondary"
          ref={editButtonRef}
          disabled={busy}
          onClick={onEdit}
        >
          Editar<span className="sr-only"> {item.label}</span>
        </button>
        <button className="shopping-button secondary" disabled={busy} onClick={onRemove}>
          Quitar<span className="sr-only"> {item.label}</span>
        </button>
      </div>
    </article>
  );
}
