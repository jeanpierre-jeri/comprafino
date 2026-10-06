import { normalizeSearchQuery } from "@comprafino/core";
import type { ShoppingCreationSeed, ShoppingListItem } from "@comprafino/core";

export function shoppingEditorDefaults(seed: ShoppingCreationSeed, item?: ShoppingListItem) {
  const generic = item ? item.intent === "generic" : !seed.canonicalId;
  const quantityMode = item?.quantityMode ?? (generic ? "normalized" : "packages");
  let initialQuantity: ShoppingListItem["quantity"] = { amount: 1, unit: "unit" };

  if (item) {
    initialQuantity = item.quantity;
  } else if (generic && seed.quantity) {
    initialQuantity = seed.quantity;
  }

  return {
    generic,
    quantityMode,
    packages: quantityMode === "packages",
    amount: String(initialQuantity.amount),
    unit: initialQuantity.unit,
    intent: item?.intent ?? (generic ? "generic" : "preferred"),
    frequency: item?.frequency ?? "weekly",
    label: item?.label ?? seed.label,
    query: normalizeSearchQuery(item?.query ?? seed.query),
    canonicalId: item?.canonicalId ?? seed.canonicalId,
    substitutionsWithheld:
      generic && (item ? item.substitutionProfile === null : seed.substitutionProfile === null),
  };
}

export function quantityUnitFromInput(value: string): ShoppingListItem["quantity"]["unit"] {
  if (value === "kg" || value === "L") return value;

  return "unit";
}

export function frequencyFromInput(value: string): ShoppingListItem["frequency"] {
  if (value === "monthly" || value === "biweekly") return value;

  return "weekly";
}

export function editorSaveLabel(editing: boolean, duplicate: boolean): string {
  if (editing) return "Guardar cambios";

  if (duplicate) return "Actualizar existente";

  return "Agregar";
}
