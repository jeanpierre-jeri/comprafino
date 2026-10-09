"use client";

import type { Ref } from "react";
import { Button } from "@comprafino/ui/components/button";
import { ChevronDown, Pencil } from "@comprafino/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@comprafino/ui/components/collapsible";
import {
  formatPen,
  shoppingSavingsNotice,
  shoppingFrequencyLabels,
  weekdayLabels,
} from "@comprafino/core";
import type { ShoppingListItem, ShoppingEvaluation, ShoppingWeekday } from "@comprafino/core";
import { ShoppingSavingsMessage } from "./shopping-savings-notices";
import { CurrentOption } from "../current-shopping-option";
import { AvailabilityNotice } from "../availability-notice";

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
  weekday?: ShoppingWeekday;
  pending: boolean;
  error: string;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
  editButtonRef: Ref<HTMLButtonElement>;
};

function PriceStatus({
  item,
  result,
  pending,
  error,
}: Pick<CardProps, "item" | "result" | "pending" | "error">) {
  let label = "Sin precio comparable";

  if (pending) {
    label = "Actualizando…";
  } else if (error) {
    label = "Precio no disponible";
  } else if (item.intent === "preferred" && !result?.preferred) {
    label = "Sin precio del preferido";
  }

  return <p className="max-w-32 text-right text-sm text-muted-foreground">{label}</p>;
}

function MissingPriceDetails({
  item,
  result,
  pending,
  error,
}: Pick<CardProps, "item" | "result" | "pending" | "error">) {
  if (pending) return <p className="text-sm">Buscando opciones actuales…</p>;
  if (error) return <p className="text-sm">Precios no disponibles.</p>;
  if (item.intent === "preferred" && result?.alternative && !result.preferred) {
    return <p className="text-sm">Tu producto preferido no tiene un precio válido actual.</p>;
  }

  return (
    <p className="text-sm">No encontramos alternativas suficientemente comparables por ahora.</p>
  );
}

export function ShoppingItemCard({
  item,
  weekday,
  result,
  pending,
  error,
  busy,
  onEdit,
  onRemove,
  editButtonRef,
}: CardProps) {
  const notice = !pending && !error && result ? shoppingSavingsNotice(item, result) : null;
  // A preferred item's alternative is separate from its own quote. Refreshes and
  // failures cannot leave an old price or savings opportunity in the compact row.
  const option =
    !pending && !error && (item.intent !== "preferred" || result?.preferred)
      ? result?.best
      : undefined;
  const recommendedDay = weekday?.series.find((series) => series.pattern.status === "recommended");

  return (
    <article
      id={`shopping-item-${item.id}`}
      tabIndex={-1}
      className="scroll-mt-6 px-4 py-3 sm:px-5"
      aria-label={item.label}
    >
      <Collapsible>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-2 sm:gap-x-4">
          <div className="min-w-0">
            <h3 className="font-semibold wrap-anywhere">{item.label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.quantity.amount} {quantityLabel(item)}
              {option && ` · ${option.retailerName}`}
            </p>
          </div>
          <div className="pt-0.5">
            {option ? (
              <p className="text-lg font-semibold tabular-nums">
                {formatPen(option.totalCostCents)}
              </p>
            ) : (
              <PriceStatus item={item} result={result} pending={pending} error={error} />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            title={`Editar ${item.label}`}
            ref={editButtonRef}
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
            <span className="sr-only">Editar {item.label}</span>
          </Button>
        </div>
        {option?.condition && (
          <p className="mt-1 text-sm text-primary">
            Precio potencial · {option.condition} · Para todos:{" "}
            {formatPen(option.ordinaryTotalCents)}
          </p>
        )}
        {option && option.available !== true && <AvailabilityNotice available={option.available} />}
        {!pending &&
          !error &&
          result &&
          recommendedDay &&
          recommendedDay.pattern.weekday !== null && (
            <p className="mt-1 text-sm text-muted-foreground">
              Menor precio observado: {weekdayLabels[recommendedDay.pattern.weekday]} en{" "}
              {recommendedDay.retailerName}
            </p>
          )}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
          {notice ? (
            <p className="text-sm text-primary">
              Oportunidad: {formatPen(notice.savingsCents)} menos
              {notice.option.condition && ` · ${notice.option.condition}`}
              {notice.baseline.condition &&
                notice.baseline.condition !== notice.option.condition &&
                ` · comparación con ${notice.baseline.condition}`}
            </p>
          ) : (
            <span />
          )}
          <CollapsibleTrigger
            data-shopping-details-trigger
            render={<Button variant="ghost" className="group min-h-11" />}
            aria-label={`Ver detalles de ${item.label}`}
          >
            Ver detalles
            <ChevronDown
              data-icon="inline-end"
              aria-hidden="true"
              className="transition-transform group-aria-expanded:rotate-180"
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent keepMounted>
          <div className="pt-3">
            <div className="flex flex-col gap-5 border-t pt-4 pb-3">
              <p className="text-sm text-muted-foreground">
                {intentLabels[item.intent]} · {shoppingFrequencyLabels[item.frequency]}
              </p>
              {option ? (
                <section aria-label="Producto y precio">
                  <h4 className="text-sm font-semibold">
                    {item.intent === "preferred" ? "Tu producto preferido" : "Mejor opción actual"}
                  </h4>
                  <CurrentOption option={option} />
                </section>
              ) : (
                <MissingPriceDetails item={item} result={result} pending={pending} error={error} />
              )}
              {notice && <ShoppingSavingsMessage notice={notice} />}
              {!pending && !error && result?.alternative && (
                <section aria-label="Alternativa compatible hoy">
                  <h4 className="text-sm font-semibold">Alternativa compatible hoy</h4>
                  <CurrentOption option={result.alternative} />
                </section>
              )}
              {!pending &&
                !error &&
                item.intent !== "preferred" &&
                result &&
                result.options.length > 1 && (
                  <section
                    aria-label={
                      item.intent === "strict"
                        ? "Otras tiendas del mismo producto"
                        : "Otras opciones compatibles"
                    }
                  >
                    <h4 className="text-sm font-semibold">
                      {item.intent === "strict"
                        ? "Otras tiendas del mismo producto"
                        : "Otras opciones compatibles"}
                    </h4>
                    <ul className="flex flex-col gap-4">
                      {result.options.slice(1).map((otherOption) => (
                        <li key={otherOption.id}>
                          <CurrentOption option={otherOption} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              {!pending && !error && result && <WeekdayAdvice recommendation={weekday} />}
              <div>
                <Button
                  variant="destructive"
                  className="min-h-11"
                  aria-label={`Quitar ${item.label}`}
                  disabled={busy}
                  onClick={onRemove}
                >
                  Quitar de la lista<span className="sr-only"> {item.label}</span>
                </Button>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

function WeekdayAdvice({ recommendation }: { recommendation?: ShoppingWeekday }) {
  const supported =
    recommendation?.series.filter((series) => series.pattern.status === "recommended") ?? [];
  const first = supported[0];
  const hasComplete = recommendation?.series.some(
    (series) => series.pattern.status === "no_pattern",
  );

  if (!first || first.pattern.weekday === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {hasComplete
          ? "No observamos un patrón claro para recomendar un día."
          : "Aún no hay suficiente historial para recomendar un día"}
      </p>
    );
  }

  return (
    <section aria-label="Fundamento del día sugerido" className="text-sm">
      <h4 className="font-semibold">Fundamento del día sugerido</h4>
      <p className="mt-2">
        {weekdayLabels[first.pattern.weekday]} en {first.retailerName}: el menor precio para todos
        observado en las cuatro semanas completas.
      </p>
      {supported.map((series) => (
        <p className="mt-2" key={series.listingId}>
          {series.retailerName}: {weekdayLabels[series.pattern.weekday ?? 0]}, con 28 fechas
          comparables del {series.pattern.start} al {series.pattern.end} (America/Lima).
        </p>
      ))}
      <p className="mt-2 text-muted-foreground">
        Comparamos el mismo producto y supermercado, sin beneficios condicionados. El día fue el
        único mínimo en cada semana, al menos S/ 1 y 5 % por debajo de cada otro día. Las
        observaciones no garantizan el precio entre consultas ni precios o stock futuros.
      </p>
    </section>
  );
}
