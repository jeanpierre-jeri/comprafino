import { describe, expect, it } from "vitest";
let sequence = 0;
const fixtureId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import {
  shoppingListSyncRequestSchema,
  shoppingListSyncOperationSchema,
  shoppingListRevisionSchema,
  shoppingListRevisionMaximum,
  remoteShoppingListStateSchema,
  remoteShoppingListSchema,
  shoppingListRevisionConflictSchema,
} from "./shopping-list-sync.ts";
import { emptyShoppingList } from "./shopping-list.ts";
const item = () => ({
  id: fixtureId(),
  intent: "generic",
  canonicalId: null,
  label: "Huevos",
  query: "huevos",
  quantity: { amount: 30, unit: "unit" },
  frequency: "weekly",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});
describe("strict shopping sync wire boundaries", () => {
  it("accepts int32 revisions and rejects negative, fractional, overflowing and nonnumeric input", () => {
    for (const value of [0, 1, shoppingListRevisionMaximum])
      expect(shoppingListRevisionSchema.safeParse(value).success).toBe(true);
    for (const value of [-1, 0.5, shoppingListRevisionMaximum + 1, Infinity, "0", null])
      expect(shoppingListRevisionSchema.safeParse(value).success).toBe(false);
  });
  it("reuses item defaults and package/quantity invariants", () => {
    const saved = shoppingListSyncOperationSchema.parse({ type: "save", item: item() });
    expect(saved).toMatchObject({
      item: { quantityMode: "normalized", substitutionProfile: null },
    });
    for (const value of [
      { ...item(), quantity: { amount: 1.5, unit: "unit" } },
      {
        ...item(),
        intent: "strict",
        canonicalId: fixtureId(),
        quantityMode: "packages",
        quantity: { amount: 2, unit: "kg" },
      },
    ])
      expect(shoppingListSyncOperationSchema.safeParse({ type: "save", item: value }).success).toBe(
        false,
      );
  });
  it("rejects extra fields at all request depths and accepts only UUID removal", () => {
    const request = { expectedRevision: 0, operation: { type: "save", item: item() } };
    for (const value of [
      { ...request, userId: fixtureId() },
      { ...request, list: emptyShoppingList() },
      { ...request, operation: { ...request.operation, extra: true } },
      { ...request, operation: { type: "save", item: { ...item(), extra: true } } },
      {
        ...request,
        operation: {
          type: "save",
          item: { ...item(), quantity: { amount: 1, unit: "unit", extra: true } },
        },
      },
      { expectedRevision: 0, operation: { type: "clear" } },
      { expectedRevision: 0, operation: { type: "remove", id: "invalid" } },
    ])
      expect(shoppingListSyncRequestSchema.safeParse(value).success).toBe(false);
    expect(
      shoppingListSyncRequestSchema.safeParse({
        expectedRevision: 1,
        operation: { type: "remove", id: fixtureId() },
      }).success,
    ).toBe(true);
  });
  it("validates remote/conflict documents, canonical absence and duplicate needs", () => {
    const current = { revision: 0, list: emptyShoppingList() };
    expect(remoteShoppingListStateSchema.parse(current)).toEqual(current);
    expect(
      shoppingListRevisionConflictSchema.parse({ error: "revision_conflict", current }),
    ).toEqual({ error: "revision_conflict", current });
    for (const value of [
      { ...current, userId: fixtureId() },
      { revision: 0, list: { version: 2, items: [item()] } },
      { revision: 1, list: { version: 3, items: [] } },
      { revision: 1, list: { version: 2, items: [item(), item()] } },
      { revision: 1, list: { version: 2, items: [], extra: true } },
    ])
      expect(remoteShoppingListStateSchema.safeParse(value).success).toBe(false);
    expect(shoppingListRevisionConflictSchema.safeParse({ error: "other", current }).success).toBe(
      false,
    );
    expect(
      shoppingListRevisionConflictSchema.safeParse({
        error: "revision_conflict",
        current,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

it("strict remote documents preserve defaults and reject unknown keys at every object boundary", () => {
  const value = item();
  expect(remoteShoppingListSchema.parse({ version: 2, items: [value] }).items[0]).toMatchObject({
    quantityMode: "normalized",
    substitutionProfile: null,
  });
  for (const document of [
    { version: 2, items: [], extra: true },
    { version: 2, items: [{ ...value, extra: true }] },
    { version: 2, items: [{ ...value, quantity: { ...value.quantity, extra: true } }] },
    { version: 3, items: [] },
  ])
    expect(remoteShoppingListSchema.safeParse(document).success).toBe(false);
});
