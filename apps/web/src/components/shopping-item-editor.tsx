"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  saveShoppingItem,
  shoppingFrequencyLabels,
  shoppingIntentLabels,
  shoppingItemKey,
  shoppingListItemSchema,
  shoppingQueryForTitle,
  shoppingGenericNeedKey,
} from "@comprafino/core";
import type { ShoppingListItem } from "@comprafino/core";
import { useShoppingList } from "./use-shopping-list";
export type ShoppingSeed = {
  label: string;
  query: string;
  canonicalId: string | null;
  quantity?: ShoppingListItem["quantity"];
};
export function ShoppingItemEditor({
  seed,
  item,
  close,
  onSaved,
}: {
  seed: ShoppingSeed;
  item?: ShoppingListItem;
  close: () => void;
  onSaved?: () => void;
}) {
  const { list, change } = useShoppingList();
  const dialog = useRef<HTMLDialogElement>(null);
  const fieldId = useId();
  const [intent, setIntent] = useState<ShoppingListItem["intent"]>(
    item?.intent ?? (seed.canonicalId ? "preferred" : "generic"),
  );
  const [label, setLabel] = useState(item?.label ?? seed.label);
  const [query, setQuery] = useState(item?.query ?? seed.query);
  const [canonicalId, setCanonicalId] = useState(item?.canonicalId ?? seed.canonicalId);
  const [amount, setAmount] = useState(String(item?.quantity.amount ?? seed.quantity?.amount ?? 1));
  const [unit, setUnit] = useState<ShoppingListItem["quantity"]["unit"]>(
    item?.quantity.unit ?? seed.quantity?.unit ?? "unit",
  );
  const [frequency, setFrequency] = useState<ShoppingListItem["frequency"]>(
    item?.frequency ?? "weekly",
  );
  const [products, setProducts] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function dismiss() {
    dialog.current?.close();
    close();
  }
  const duplicate = list.items.find(
    (i) =>
      i.id !== item?.id &&
      shoppingItemKey(i) ===
        `${intent}:${intent === "generic" ? shoppingGenericNeedKey(query, unit) : canonicalId}:${unit}`,
  );
  async function searchProducts() {
    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/list/products?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        !("products" in body) ||
        !Array.isArray(body.products)
      )
        throw new Error("No pudimos buscar productos.");
      const validated: { id: string; label: string }[] = [];
      for (const p of body.products) {
        if (
          typeof p !== "object" ||
          p === null ||
          !("id" in p) ||
          typeof p.id !== "string" ||
          !("label" in p) ||
          typeof p.label !== "string"
        )
          throw new Error("Respuesta de productos inválida.");
        validated.push({ id: p.id, label: p.label });
      }
      setProducts(validated);
      if (!validated.length) setError("No encontramos productos. Prueba otra búsqueda.");
    } catch {
      setError("No pudimos buscar productos. Intenta nuevamente.");
    } finally {
      setSearching(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="shopping-dialog"
      aria-labelledby="shopping-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const now = new Date().toISOString();
          const parsed = shoppingListItemSchema.safeParse({
            id: item?.id ?? crypto.randomUUID(),
            label,
            query,
            intent,
            canonicalId: intent === "generic" ? null : canonicalId,
            quantity: { amount: Number(amount), unit },
            frequency,
            createdAt: item?.createdAt ?? now,
            updatedAt: now,
          });
          if (!parsed.success) {
            setError(
              "Revisa la cantidad, la búsqueda y selecciona un producto para guardar una preferencia.",
            );
            return;
          }
          try {
            change((current) => saveShoppingItem(current, parsed.data));
            onSaved?.();
            dismiss();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "No pudimos guardar la lista.");
          }
        }}
      >
        <h2 id="shopping-editor-title" className="text-2xl font-semibold">
          {item ? "Editar necesidad" : "Agregar a mi lista"}
        </h2>
        <fieldset className="mt-5 space-y-3">
          <legend className="mb-2 font-medium">¿Qué quieres comprar?</legend>
          {Object.entries(shoppingIntentLabels).map(([value, text]) => (
            <label key={value} className="flex items-center gap-3">
              <input
                type="radio"
                name="intent"
                value={value}
                checked={intent === value}
                onChange={() => {
                  setIntent(
                    value === "strict" ? "strict" : value === "preferred" ? "preferred" : "generic",
                  );
                  if (value === "generic" && canonicalId) {
                    setQuery(shoppingQueryForTitle(label));
                    setLabel(shoppingQueryForTitle(label));
                  }
                }}
              />
              {text}
            </label>
          ))}
        </fieldset>
        {intent === "generic" && (
          <p className="mt-3 text-sm text-muted-foreground">
            Comparamos huevos comunes, arroz blanco, aceite vegetal o girasol y detergente en polvo
            o líquido. Para otras variedades, selecciona un producto exacto.
          </p>
        )}
        <label className="shopping-field">
          Nombre en tu lista
          <input
            value={label}
            maxLength={120}
            minLength={2}
            required
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="shopping-field">
          Búsqueda de productos
          <input
            value={query}
            maxLength={120}
            minLength={2}
            required
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {intent !== "generic" && (
          <div className="mt-3">
            {canonicalId && <p className="text-sm">Producto seleccionado: {label}</p>}
            <button
              type="button"
              className="card-link"
              disabled={searching}
              onClick={() => void searchProducts()}
            >
              {searching ? "Buscando…" : "Buscar producto para seleccionar"}
            </button>
            {products.length > 0 && (
              <div className="shopping-field">
                <label htmlFor={`${fieldId}-product`}>Producto exacto</label>
                <select
                  id={`${fieldId}-product`}
                  value={canonicalId ?? ""}
                  onChange={(e) => {
                    const p = products.find((product) => product.id === e.target.value);
                    if (p) {
                      setCanonicalId(p.id);
                      setLabel(p.label);
                    }
                  }}
                >
                  <option value="">Selecciona un producto</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="shopping-field">
            Cantidad
            <input
              type="number"
              min={unit === "unit" ? "1" : "0.001"}
              max="10000"
              step={unit === "unit" ? "1" : "0.001"}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className="shopping-field">
            <label htmlFor={`${fieldId}-unit`}>Medida</label>
            <select
              id={`${fieldId}-unit`}
              value={unit}
              onChange={(e) =>
                setUnit(e.target.value === "kg" ? "kg" : e.target.value === "L" ? "L" : "unit")
              }
            >
              <option value="unit">Unidades</option>
              <option value="kg">kg</option>
              <option value="L">L</option>
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Para un producto exacto medido en kg o L, “unidades” cuenta envases o packs de venta
          completos. Las alternativas requieren la misma medida.
        </p>
        <div className="shopping-field">
          <label htmlFor={`${fieldId}-frequency`}>Frecuencia</label>
          <select
            id={`${fieldId}-frequency`}
            value={frequency}
            onChange={(e) =>
              setFrequency(
                e.target.value === "monthly"
                  ? "monthly"
                  : e.target.value === "biweekly"
                    ? "biweekly"
                    : "weekly",
              )
            }
          >
            {Object.entries(shoppingFrequencyLabels).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
        {duplicate && (
          <p className="mt-3 text-sm">
            Ya tienes esta necesidad. Al guardar actualizarás su cantidad y frecuencia.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="shopping-button" type="submit">
            {duplicate && !item ? "Actualizar existente" : item ? "Guardar cambios" : "Agregar"}
          </button>
          <button className="shopping-button secondary" type="button" onClick={dismiss}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function AddShoppingItem({ seed }: { seed: ShoppingSeed }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { ready, warning } = useShoppingList();
  return (
    <div className="mt-4">
      <button
        ref={trigger}
        className="shopping-button secondary"
        disabled={!ready}
        onClick={() => {
          setOpen(true);
          setSaved(false);
        }}
      >
        {seed.canonicalId ? "Agregar a mi lista" : "Agregar como necesidad"}
      </button>
      {saved && !open && <output className="mt-2 block text-sm">Guardado en Mi lista.</output>}
      {warning && <output className="mt-2 block text-sm">{warning}</output>}
      {open && (
        <ShoppingItemEditor
          seed={seed}
          onSaved={() => setSaved(true)}
          close={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}
