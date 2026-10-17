"use client";

import Link from "next/link";
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
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@comprafino/ui/components/dialog";
import { Alert, AlertTitle, AlertDescription } from "@comprafino/ui/components/alert";
import { Button, buttonVariants } from "@comprafino/ui/components/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@comprafino/ui/components/collapsible";
import { useShoppingList } from "./use-shopping-list";
import { sameShoppingSession } from "../../lib/shopping-list/session";

import {
  shoppingEditorDefaults,
  quantityUnitFromInput,
  frequencyFromInput,
  editorSaveLabel,
  editorQuantityLabel,
  editorSubstitutionSummary,
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
      <DialogContent className="shopping-dialog gap-0" initialFocus={initialFocus}>
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
  const [quantityInvalid, setQuantityInvalid] = useState(false);
  const [identity] = useState(() => ({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }));

  const substitutionProfile =
    generic && !substitutionsWithheld ? inferGenericSubstitutionProfile(query, unit) : null;
  const parsedDraft = shoppingListItemSchema.safeParse({
    id: item?.id ?? identity.id,
    label,
    query,
    intent,
    canonicalId: generic ? null : canonicalId,
    listingId: defaults.listingId,
    quantity: { amount: Number(amount), unit },
    quantityMode,
    substitutionProfile,
    frequency,
    createdAt: item?.createdAt ?? identity.createdAt,
    updatedAt: item?.updatedAt ?? identity.createdAt,
  });
  const duplicate =
    parsedDraft.success &&
    list.items.find(
      (i) => i.id !== item?.id && shoppingItemKey(i) === shoppingItemKey(parsedDraft.data),
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (closing || saving || !ready || busy || accountChanged) return;

    setError("");
    if (!parsedDraft.success) {
      setError("Revisa la cantidad antes de guardar.");

      return;
    }

    try {
      setSaving(true);
      // oxlint-disable-next-line react/purity -- This timestamp is read only in the submit event handler.
      const savedItem = { ...parsedDraft.data, updatedAt: new Date().toISOString() };
      await change((current) => saveShoppingItem(current, savedItem));
      onSaved?.();
      dismiss();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No pudimos guardar la lista.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={saving}>
      <DialogTitle id={titleId} className="pr-12">
        {item ? `Editar “${label}”` : `Agregar “${label}” a mi lista`}
      </DialogTitle>
      <DialogDescription className="mt-2">
        {generic
          ? "Guardas “leche” sin elegir marca. Solo compararemos opciones con equivalencia comprobada."
          : "Conserva la marca y presentación que elegiste. Ejemplo: leche de una marca concreta de 1 L."}
      </DialogDescription>
      {!generic && !packages && (
        <p className="mt-3 text-sm text-muted-foreground">
          Conservamos la cantidad de tu lista anterior. Esta compra sigue expresada en{" "}
          {unit === "unit" ? "unidades" : unit}.
        </p>
      )}
      <p className="mt-4 text-base font-semibold">
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
            aria-invalid={quantityInvalid || undefined}
            aria-describedby={`${fieldId}-quantity-help ${fieldId}-quantity-error`}
            onInvalid={() => setQuantityInvalid(true)}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setQuantityInvalid(false);
              setError("");
            }}
          />
        </label>
        {!packages && (
          <div className="shopping-field">
            <label htmlFor={`${fieldId}-unit`}>Medida</label>
            <select
              id={`${fieldId}-unit`}
              value={unit}
              onChange={(e) => {
                setUnit(quantityUnitFromInput(e.target.value));
                setQuantityInvalid(false);
                setError("");
              }}
            >
              <option value="unit">Unidades</option>
              <option value="kg">kg</option>
              <option value="L">L</option>
            </select>
          </div>
        )}
      </div>
      <p id={`${fieldId}-quantity-help`} className="mt-2 text-sm text-muted-foreground">
        {packages
          ? "Cada paquete es una presentación completa del producto elegido. Usa una cantidad entera."
          : "Total que necesitas: 6 unidades, 0.5 kg o 2 L. Unidades enteras; kg y L con hasta 3 decimales."}
      </p>
      <div id={`${fieldId}-quantity-error`}>
        {quantityInvalid && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {unit === "unit"
              ? "Ingresa una cantidad entera entre 1 y 10000."
              : "Ingresa una cantidad mayor que 0 y hasta 10000, con un máximo de 3 decimales."}
          </p>
        )}
      </div>
      <section
        aria-label="Resumen de preferencias"
        className="mt-4 rounded-xl border bg-surface p-3"
      >
        <h3 className="font-semibold">Así quedará en tu lista</h3>
        <p className="mt-1 break-words">
          {parsedDraft.success ? editorQuantityLabel(parsedDraft.data) : "Revisa la cantidad"} ·{" "}
          {shoppingFrequencyLabels[frequency]}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {editorSubstitutionSummary(intent, Boolean(substitutionProfile))}
        </p>
      </section>
      <Collapsible defaultOpen={Boolean(item)} className="mt-2">
        <CollapsibleTrigger
          render={<Button variant="ghost" className="min-h-11 w-full justify-between" />}
        >
          {generic ? "Ajustar frecuencia" : "Ajustar sustituciones y frecuencia"}
          <span aria-hidden="true">⌄</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {!generic && (
            <fieldset className="mt-4 flex flex-col gap-3">
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
                      {value === "preferred"
                        ? "Prefiero este producto"
                        : "Solo quiero este producto"}
                    </span>
                    <span
                      id={`${fieldId}-${value}-help`}
                      className="mt-1 block text-sm text-muted-foreground"
                    >
                      {value === "preferred"
                        ? "Mostraremos alternativas equivalentes si ahorran al menos S/ 1 y 5%, o si este producto no está disponible."
                        : "No sustituiremos por otra marca o presentación."}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="shopping-field">
            <label htmlFor={`${fieldId}-frequency`}>Frecuencia</label>
            <select
              id={`${fieldId}-frequency`}
              aria-describedby={`${fieldId}-frequency-help`}
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
          <p id={`${fieldId}-frequency-help`} className="mt-2 text-sm text-muted-foreground">
            Es cada cuánto sueles comprar esta cantidad. Sirve para organizar tu lista; no crea
            pedidos ni recordatorios.
          </p>
        </CollapsibleContent>
      </Collapsible>
      {duplicate && (
        <Alert role="note" aria-label="Necesidad existente" className="mt-3">
          <AlertTitle>Ya tienes esta necesidad</AlertTitle>
          <AlertDescription>
            Ahora: {editorQuantityLabel(duplicate)} · {shoppingFrequencyLabels[duplicate.frequency]}
            . Al guardar, su cantidad y frecuencia se reemplazarán por las del resumen.
          </AlertDescription>
        </Alert>
      )}
      {accountChanged && <p role="alert">La cuenta cambió. Cierra el editor y vuelve a abrirlo.</p>}
      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
      <div className="shopping-editor-actions mt-4 flex flex-wrap gap-3">
        <button
          className="shopping-button"
          type="submit"
          disabled={closing || saving || !ready || busy || accountChanged}
        >
          {saving ? "Guardando…" : editorSaveLabel(Boolean(item), Boolean(duplicate))}
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
  primary = false,
  inline = false,
}: {
  seed: ShoppingSeed;
  compact?: boolean;
  buttonLabel?: string;
  primary?: boolean;
  inline?: boolean;
}) {
  const { ready, warning, busy, session } = useShoppingList();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ session: typeof session; seed: ShoppingSeed } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  let buttonClass = "shopping-button secondary";

  if (compact) {
    buttonClass = "card-link inline-flex min-h-11 items-center text-sm";
  } else if (primary) {
    buttonClass = "shopping-button";
  }

  const containerClass = inline ? "" : "mt-4";

  return (
    <div className={compact ? "mt-2" : containerClass}>
      <button
        ref={trigger}
        className={buttonClass}
        disabled={!ready || busy}
        onClick={() => {
          setOpen(true);
          setSaved(null);
        }}
      >
        {buttonLabel ??
          (seed.canonicalId || seed.listingId ? "Agregar a mi lista" : "Agregar como necesidad")}
      </button>
      {saved &&
        sameShoppingSession(saved.session, session) &&
        saved.seed.query === seed.query &&
        saved.seed.canonicalId === seed.canonicalId &&
        saved.seed.listingId === seed.listingId &&
        !open && (
          <Alert role="note" aria-label="Confirmación de guardado" className="mt-3">
            <output className="font-semibold">Guardado en Mi lista.</output>
            <AlertDescription>{saved.seed.label}</AlertDescription>
            <div className="flex flex-wrap gap-2">
              <Link href="/list" className={buttonVariants({ className: "min-h-11" })}>
                Ver mi lista
              </Link>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setSaved(null);
                  trigger.current?.focus();
                }}
              >
                Seguir comprando
              </Button>
            </div>
          </Alert>
        )}
      {warning && <output className="mt-2 block text-sm">{warning}</output>}
      {open && (
        <ShoppingItemEditor
          seed={seed}
          onSaved={() => setSaved({ session, seed })}
          close={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}
