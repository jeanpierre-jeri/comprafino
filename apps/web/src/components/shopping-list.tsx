"use client";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  formatPen,
  removeShoppingItem,
  shoppingListEvaluationSchema,
  shoppingFrequencyLabels,
} from "@comprafino/core";
import type {
  PriceMode,
  ShoppingEvaluation,
  ShoppingList,
  ShoppingListItem,
  BasketPlan,
} from "@comprafino/core";
import { useShoppingList } from "./use-shopping-list";
import { BasketComparison } from "./basket-comparison";
import { CurrentOption } from "./current-shopping-option";
import { ShoppingItemEditor } from "./shopping-item-editor";

export function ShoppingListView() {
  const pricingId = useId();
  const { list, ready, warning, change, busy, authenticated, retry } = useShoppingList();
  const [mode, setMode] = useState<PriceMode>("standard");
  const [revision, setRevision] = useState(0);
  const [market, setMarket] = useState<{
    list: ShoppingList;
    mode: PriceMode;
    revision: number;
    evaluations: ShoppingEvaluation[];
    baskets: BasketPlan[];
  } | null>(null);
  // Effects clear old responses after commit. Withhold them during that render
  // too: a removed item must never be looked up in an older basket assignment.
  const currentMarket =
    market?.list === list && market.mode === mode && market.revision === revision ? market : null;
  const evaluations = currentMarket?.evaluations ?? [];
  const baskets = currentMarket?.baskets ?? [];
  const [selectedBasketLimit, setSelectedBasketLimit] = useState<number | null>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<ShoppingListItem | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusItemId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (editing || !focusItemId.current) return;
    // Changing frequency remounts the card in a different section. Restore
    // focus to its current button after React has committed that move.
    editButtons.current.get(focusItemId.current)?.focus();
    focusItemId.current = null;
  }, [editing]);
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    async function load() {
      setMarket(null);
      setError("");
      if (!list.items.length) {
        setPending(false);
        return;
      }
      setPending(true);
      try {
        const response = await fetch(`/api/list/evaluate?priceMode=${mode}&refresh=${revision}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(list),
          signal: controller.signal,
          cache: "no-store",
        });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("No pudimos cargar los precios.");
        const parsed = shoppingListEvaluationSchema.parse(body);
        if (!controller.signal.aborted) {
          setMarket({
            list,
            mode,
            revision,
            evaluations: parsed.evaluations,
            baskets: parsed.baskets,
          });
        }
      } catch {
        if (!controller.signal.aborted)
          setError("No pudimos cargar los precios. Intenta nuevamente.");
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }
    void load();
    // Refresh on return to the tab and every minute; never show an indefinitely
    // cached current recommendation on a long-lived page.
    const refresh = () => {
      if (!document.hidden) setRevision((r) => r + 1);
    };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [list, mode, ready, revision]);
  return (
    <>
      <p className="eyebrow">Tus compras habituales</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Mi lista de compras</h1>
      <p className="mt-3 text-muted-foreground">
        Guarda lo que necesitas y compara cuánto cuesta hoy.{" "}
        {authenticated
          ? "Tu lista se sincroniza con tu cuenta."
          : "Sin cuenta; se guarda en este navegador."}
      </p>
      {warning && <output className="empty-surface mt-4 block">{warning}</output>}
      {authenticated && warning && (
        <button className="shopping-button secondary mt-3" disabled={busy} onClick={retry}>
          Reintentar sincronización
        </button>
      )}
      {!ready ? (
        <output className="mt-6 block">Cargando tu lista…</output>
      ) : !list.items.length ? (
        <div className="empty-surface mt-6">
          <h2 className="text-xl font-semibold">Todavía no tienes productos en tu lista.</h2>
          <p className="mt-3">
            Busca huevos, arroz o cualquier producto que compres seguido y agrégalo aquí.
          </p>
          <Link className="card-link" href="/search">
            Buscar productos
          </Link>
        </div>
      ) : (
        <>
          <div className="shopping-field max-w-sm">
            <label htmlFor={pricingId}>Precios</label>
            <select
              id={pricingId}
              value={mode}
              onChange={(e) => setMode(e.target.value === "benefits" ? "benefits" : "standard")}
            >
              <option value="standard">Para todos</option>
              <option value="benefits">Incluir beneficios</option>
            </select>
          </div>
          <div className="empty-surface mt-5" aria-live="polite">
            {pending ? (
              <p>Comparando precios actuales…</p>
            ) : error ? (
              <>
                <p role="alert">{error}</p>
                <button className="card-link" onClick={() => setRevision((r) => r + 1)}>
                  Reintentar
                </button>
              </>
            ) : (
              <BasketComparison
                plans={baskets}
                items={list.items}
                selectedLimit={selectedBasketLimit}
                selectLimit={setSelectedBasketLimit}
              />
            )}
          </div>
          {Object.entries(shoppingFrequencyLabels).map(([frequency, label]) => {
            const items = list.items.filter((i) => i.frequency === frequency);
            if (!items.length) return null;
            return (
              <section className="mt-8" key={frequency} aria-label={label}>
                <h2 className="text-2xl font-semibold">{label}</h2>
                <ul className="mt-4 grid gap-4 md:grid-cols-2">
                  {items.map((item) => {
                    const result = evaluations.find((e) => e.itemId === item.id);
                    return (
                      <li key={item.id}>
                        <article className="empty-surface h-full" aria-label={item.label}>
                          <h3 className="text-xl font-semibold wrap-break-word">{item.label}</h3>
                          <p className="mt-2 text-sm">
                            {item.quantity.amount}{" "}
                            {item.quantityMode === "packages"
                              ? item.quantity.amount === 1
                                ? "paquete"
                                : "paquetes"
                              : item.quantity.unit === "unit"
                                ? "unidades"
                                : item.quantity.unit}{" "}
                            · {shoppingFrequencyLabels[item.frequency]}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.intent === "generic"
                              ? "Cualquier opción equivalente"
                              : item.intent === "preferred"
                                ? "Producto preferido"
                                : "Producto exacto"}
                          </p>
                          {pending ? (
                            <p className="mt-4">Buscando opciones actuales…</p>
                          ) : error ? (
                            <p className="mt-4">Precios no disponibles.</p>
                          ) : result?.best && (item.intent !== "preferred" || result.preferred) ? (
                            <>
                              <p className="mt-4 text-sm font-medium">
                                {item.intent === "preferred" && result.preferred
                                  ? "Tu producto preferido"
                                  : "Mejor opción actual"}
                              </p>
                              <CurrentOption option={result.best} />
                            </>
                          ) : (
                            <p className="mt-4">
                              No encontramos alternativas suficientemente comparables por ahora.
                            </p>
                          )}
                          {!pending && !error && result?.alternative && (
                            <aside className="benefit-surface mt-4">
                              <p className="font-medium">Alternativa compatible hoy</p>
                              {result.savingsCents > 0 && (
                                <p>Ahorra {formatPen(result.savingsCents)} en esta compra.</p>
                              )}
                              {!result.preferred && (
                                <p className="text-sm">
                                  Tu producto preferido no tiene un precio válido actual.
                                </p>
                              )}
                              <CurrentOption option={result.alternative} />
                            </aside>
                          )}
                          {!pending &&
                            !error &&
                            item.intent !== "preferred" &&
                            result &&
                            result.options.length > 1 && (
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
                              ref={(button) => {
                                if (button) editButtons.current.set(item.id, button);
                                else editButtons.current.delete(item.id);
                              }}
                              disabled={busy}
                              onClick={() => setEditing(item)}
                            >
                              Editar<span className="sr-only"> {item.label}</span>
                            </button>
                            <button
                              className="shopping-button secondary"
                              disabled={busy}
                              onClick={() =>
                                void change((current) =>
                                  removeShoppingItem(current, item.id),
                                ).catch(() => {})
                              }
                            >
                              Quitar<span className="sr-only"> {item.label}</span>
                            </button>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}
      {editing && (
        <ShoppingItemEditor
          item={editing}
          seed={editing}
          close={() => {
            focusItemId.current = editing.id;
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
