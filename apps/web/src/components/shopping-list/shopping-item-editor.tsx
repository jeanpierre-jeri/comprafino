"use client";

import { shoppingListPolicy } from "@comprafino/core";
import { useId, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import {
  saveShoppingItem,
  shoppingFrequencyLabels,
  shoppingItemKey,
  shoppingListItemSchema,
  inferGenericSubstitutionProfile,
} from "@comprafino/core";
import type { ShoppingListItem, ShoppingCreationSeed } from "@comprafino/core";
import { Dialog, DialogContent, DialogTitle } from "@comprafino/ui/components/dialog";
import { useShoppingList } from "./use-shopping-list";
import { sameShoppingSession } from "../../lib/shopping-list/session";

import {
  shoppingEditorDefaults,
  quantityUnitFromInput,
  frequencyFromInput,
  editorSaveLabel,
} from "./editor-values";

export type ShoppingSeed = ShoppingCreationSeed;

export function ShoppingItemEditor(props: {
  seed: ShoppingSeed;
  item?: ShoppingListItem;
  close: () => void;
  onSaved?: () => void;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(true);
  const initialFocus = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          props.close();
        }
      }}
    >
      <DialogContent
        className="shopping-dialog gap-0"
        initialFocus={initialFocus}
        aria-describedby={undefined}
      >
        <ShoppingItemForm
          seed={props.seed}
          item={props.item}
          onSaved={props.onSaved}
          titleId={titleId}
          initialFocus={initialFocus}
          closing={!open}
          dismiss={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ShoppingItemForm({
  seed,
  item,
  onSaved,
  titleId,
  initialFocus,
  closing,
  dismiss,
}: {
  seed: ShoppingSeed;
  item?: ShoppingListItem;
  onSaved?: () => void;
  titleId: string;
  initialFocus: RefObject<HTMLInputElement | null>;
  closing: boolean;
  dismiss: () => void;
}) {
  const { list, change, ready, busy, session } = useShoppingList();
  const [editorSession] = useState(session);
  const accountChanged = !sameShoppingSession(editorSession, session);
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  // Existing normalized exact quantities retain their measure; catalog evidence is required to change it.
  const defaults = shoppingEditorDefaults(seed, item);
  const { generic, label, query, canonicalId, quantityMode, packages, substitutionsWithheld } =
    defaults;
  const [intent, setIntent] = useState<ShoppingListItem["intent"]>(defaults.intent);
  const [amount, setAmount] = useState(defaults.amount);
  const [unit, setUnit] = useState<ShoppingListItem["quantity"]["unit"]>(defaults.unit);
  const [frequency, setFrequency] = useState<ShoppingListItem["frequency"]>(defaults.frequency);
  const [error, setError] = useState("");
  const [identity] = useState(() => ({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }));

  function draft(now = item?.updatedAt ?? identity.createdAt) {
    return shoppingListItemSchema.safeParse({
      id: item?.id ?? identity.id,
      label,
      query,
      intent,
      canonicalId: generic ? null : canonicalId,
      quantity: { amount: Number(amount), unit },
      quantityMode,
      substitutionProfile:
        generic && !substitutionsWithheld ? inferGenericSubstitutionProfile(query, unit) : null,
      frequency,
      createdAt: item?.createdAt ?? identity.createdAt,
      updatedAt: now,
    });
  }

  const parsedDraft = draft();
  const duplicate =
    parsedDraft.success &&
    list.items.find(
      (i) => i.id !== item?.id && shoppingItemKey(i) === shoppingItemKey(parsedDraft.data),
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (closing || saving || !ready || busy || accountChanged) return;

    setError("");
    const parsed = draft(new Date().toISOString());

    if (!parsed.success) {
      setError("Revisa la cantidad antes de guardar.");

      return;
    }

    try {
      setSaving(true);
      await change((current) => saveShoppingItem(current, parsed.data));
      onSaved?.();
      dismiss();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No pudimos guardar la lista.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogTitle id={titleId} className="pr-12">
        {item ? `Editar “${label}”` : `Agregar “${label}” a mi lista`}
      </DialogTitle>
      {!generic && (
        <fieldset className="mt-4 space-y-3">
          <legend className="mb-2 font-medium">¿Cómo quieres guardar este producto?</legend>
          {(["preferred", "strict"] as const).map((value) => (
            <label key={value} className="flex items-start gap-3">
              <input
                className="mt-1"
                aria-labelledby={`${fieldId}-${value}`}
                aria-describedby={`${fieldId}-${value}-help`}
                type="radio"
                name="intent"
                value={value}
                checked={intent === value}
                onChange={() => setIntent(value)}
              />
              <span>
                <span id={`${fieldId}-${value}`}>
                  {value === "preferred" ? "Prefiero este producto" : "Solo quiero este producto"}
                </span>
                <span
                  id={`${fieldId}-${value}-help`}
                  className="mt-1 block text-sm text-muted-foreground"
                >
                  {value === "preferred"
                    ? "También te mostraremos alternativas equivalentes si encontramos una mejor."
                    : "No sustituiremos por otra marca o presentación."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {!generic && !packages && (
        <p className="mt-3 text-sm text-muted-foreground">
          Conservamos la cantidad de tu lista anterior. Esta compra sigue expresada en{" "}
          {unit === "unit" ? "unidades" : unit}.
        </p>
      )}
      <p className="mt-4 text-sm font-medium">
        {packages ? "¿Cuántos paquetes compras?" : "¿Cuánto compras normalmente?"}
      </p>
      <div className={packages ? "" : "grid grid-cols-2 gap-3"}>
        <label className="shopping-field">
          {packages ? "Paquetes" : "Cantidad"}
          <input
            ref={initialFocus}
            type="number"
            min={unit === "unit" ? 1 : shoppingListPolicy.quantityStep}
            max={shoppingListPolicy.maximumAmount}
            step={unit === "unit" ? 1 : shoppingListPolicy.quantityStep}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {!packages && (
          <div className="shopping-field">
            <label htmlFor={`${fieldId}-unit`}>Medida</label>
            <select
              id={`${fieldId}-unit`}
              value={unit}
              onChange={(e) => setUnit(quantityUnitFromInput(e.target.value))}
            >
              <option value="unit">Unidades</option>
              <option value="kg">kg</option>
              <option value="L">L</option>
            </select>
          </div>
        )}
      </div>
      <div className="shopping-field">
        <label htmlFor={`${fieldId}-frequency`}>Frecuencia</label>
        <select
          id={`${fieldId}-frequency`}
          value={frequency}
          onChange={(e) => setFrequency(frequencyFromInput(e.target.value))}
        >
          {Object.entries(shoppingFrequencyLabels).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </div>
      {generic && (
        <p className="mt-3 text-sm text-muted-foreground">
          {substitutionsWithheld
            ? "Guardaremos esta necesidad. No encontramos alternativas suficientemente comparables por ahora."
            : "Compararemos opciones equivalentes entre marcas y supermercados."}
        </p>
      )}
      {duplicate && (
        <p className="mt-3 text-sm">
          Ya tienes esta necesidad. Al guardar actualizarás su cantidad y frecuencia.
        </p>
      )}
      {accountChanged && <p role="alert">La cuenta cambió. Cierra el editor y vuelve a abrirlo.</p>}
      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="shopping-button"
          type="submit"
          disabled={closing || saving || !ready || busy || accountChanged}
        >
          {editorSaveLabel(Boolean(item), Boolean(duplicate))}
        </button>
        <button className="shopping-button secondary" type="button" onClick={dismiss}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function AddShoppingItem({
  seed,
  compact = false,
  buttonLabel,
}: {
  seed: ShoppingSeed;
  compact?: boolean;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { ready, warning, busy } = useShoppingList();

  return (
    <div className={compact ? "mt-2" : "mt-4"}>
      <button
        ref={trigger}
        className={
          compact
            ? "card-link inline-flex min-h-11 items-center text-sm"
            : "shopping-button secondary"
        }
        disabled={!ready || busy}
        onClick={() => {
          setOpen(true);
          setSaved(false);
        }}
      >
        {buttonLabel ?? (seed.canonicalId ? "Agregar a mi lista" : "Agregar como necesidad")}
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
