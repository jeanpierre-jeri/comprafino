"use client";

import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { removeShoppingItem, shoppingFrequencyLabels } from "@comprafino/core";
import type { PriceMode, ShoppingListItem } from "@comprafino/core";
import { useShoppingList } from "./use-shopping-list";
import { MarketComparison } from "./market-comparison";
import { ShoppingItemCard } from "./shopping-item-card";
import { useShoppingEvaluation } from "./use-shopping-evaluation";
import { ShoppingItemEditor } from "./shopping-item-editor";

export function ShoppingListView() {
  const pricingId = useId();
  const { list, ready, warning, change, busy, authenticated, retry, session } = useShoppingList();
  const [mode, setMode] = useState<PriceMode>("standard");
  const market = useShoppingEvaluation(list, mode, ready, session);
  const { evaluations, baskets, pending, error } = market;
  const [selectedBasketLimit, setSelectedBasketLimit] = useState<number | null>(null);

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

  function renderContent() {
    if (!ready) return <output className="mt-6 block">Cargando tu lista…</output>;

    if (!list.items.length) {
      return (
        <div className="empty-surface mt-6">
          <h2 className="text-xl font-semibold">Todavía no tienes productos en tu lista.</h2>
          <p className="mt-3">
            Busca huevos, arroz o cualquier producto que compres seguido y agrégalo aquí.
          </p>
          <Link className="card-link" href="/search">
            Buscar productos
          </Link>
        </div>
      );
    }

    return (
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
          <MarketComparison
            pending={pending}
            error={error}
            retry={market.refresh}
            plans={baskets}
            items={list.items}
            selectedLimit={selectedBasketLimit}
            selectLimit={setSelectedBasketLimit}
          />
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
                      <ShoppingItemCard
                        item={item}
                        result={result}
                        pending={pending}
                        error={error}
                        busy={busy}
                        onEdit={() => setEditing(item)}
                        onRemove={() => {
                          void change((current) => removeShoppingItem(current, item.id)).catch(
                            () => {},
                          );
                        }}
                        editButtonRef={(button) => {
                          if (button) {
                            editButtons.current.set(item.id, button);
                          } else {
                            editButtons.current.delete(item.id);
                          }
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </>
    );
  }

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
      {renderContent()}
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
