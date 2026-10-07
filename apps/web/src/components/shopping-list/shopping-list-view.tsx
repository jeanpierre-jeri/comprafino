"use client";

import Link from "next/link";
import { buttonVariants } from "@comprafino/ui/components/button";
import { ChoiceSelect } from "@comprafino/ui/components/select";
import { useLayoutEffect, useRef, useState } from "react";
import { removeShoppingItem, shoppingFrequencyLabels } from "@comprafino/core";
import type { PriceMode, ShoppingListItem } from "@comprafino/core";
import { useShoppingList } from "./use-shopping-list";
import type { BasketPanel } from "../basket-comparison";
import { MarketComparison } from "./market-comparison";
import { ShoppingSavingsSummary } from "./shopping-savings-notices";
import { ShoppingItemCard } from "./shopping-item-card";
import { useShoppingEvaluation } from "./use-shopping-evaluation";
import { ShoppingItemEditor } from "./shopping-item-editor";

export function ShoppingListView() {
  const { list, ready, warning, change, busy, authenticated, retry, session } = useShoppingList();
  const [mode, setMode] = useState<PriceMode>("standard");
  const market = useShoppingEvaluation(list, mode, ready, session);
  const { evaluations, baskets, pending, error } = market;
  const [selectedBasketLimit, setSelectedBasketLimit] = useState<number | null>(null);

  const [basketPanel, setBasketPanel] = useState<BasketPanel>({ view: "comparison", open: false });

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
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/search">
            + Agregar productos
          </Link>
          <ChoiceSelect
            className="w-full sm:w-52"
            label="Precios"
            value={mode}
            options={[
              { value: "standard", label: "Para todos" },
              { value: "benefits", label: "Incluir beneficios" },
            ]}
            onValueChange={(value) => {
              if (value === "standard" || value === "benefits") {
                setMode(value);
              }
            }}
          />
        </div>
        <ShoppingSavingsSummary
          items={list.items}
          evaluations={evaluations}
          pending={pending}
          error={error}
        />
        <div className="mt-5 rounded-2xl border bg-surface p-5 sm:p-6" aria-live="polite">
          <MarketComparison
            pending={pending}
            error={error}
            retry={market.refresh}
            plans={baskets}
            items={list.items}
            selectedLimit={selectedBasketLimit}
            selectLimit={setSelectedBasketLimit}
            panel={basketPanel}
            onPanelChange={setBasketPanel}
          />
        </div>
        {Object.entries(shoppingFrequencyLabels).map(([frequency, label]) => {
          const items = list.items.filter((i) => i.frequency === frequency);

          if (!items.length) return null;

          return (
            <section className="mt-8" key={frequency} aria-label={label}>
              <h2 className="text-sm font-semibold text-muted-foreground">
                {label} · {items.length} {items.length === 1 ? "producto" : "productos"}
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {items.map((item) => {
                  const result = evaluations.find((e) => e.itemId === item.id);

                  return (
                    <li key={item.id}>
                      <ShoppingItemCard
                        item={item}
                        result={result}
                        weekday={market.weekdayRecommendations.find(
                          (recommendation) => recommendation.itemId === item.id,
                        )}
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
      <h1 className="text-3xl font-semibold sm:text-4xl">Mi lista de compras</h1>
      <p className="mt-3 text-muted-foreground">
        Lo que necesitas, al mejor precio disponible.{" "}
        {authenticated ? "Sincronizada con tu cuenta." : "Sin cuenta; se guarda en este navegador."}
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
