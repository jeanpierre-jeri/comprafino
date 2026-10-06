import { describe, it, expect } from "vitest";
import { planShoppingImport, shoppingImportOperation } from "./shopping-list-merge.ts";
import { emptyShoppingList, shoppingListItemSchema } from "./shopping-list.ts";

const item = (n: number, amount = 1, updatedAt = "2026-10-06T00:00:00.000Z") =>
  shoppingListItemSchema.parse({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    intent: "generic",
    canonicalId: null,
    label: `Necesidad ${n}`,
    query: `necesidad ${n}`,
    quantity: { amount, unit: "unit" },
    frequency: "weekly",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt,
  });

describe("anonymous import policy", () => {
  it("imports into absence and retains remote ordering", () => {
    const a = item(1),
      b = item(2);
    expect(
      planShoppingImport(emptyShoppingList(), { version: 2, items: [a] }).operations,
    ).toHaveLength(1);
    expect(
      planShoppingImport({ version: 2, items: [b] }, { version: 2, items: [a] }).list.items.map(
        (i) => i.id,
      ),
    ).toEqual([b.id, a.id]);
  });
  it("deduplicates needs, newer wins, remote wins ties and preserves remote identity", () => {
    const remote = item(1);
    const local = { ...item(2, 8, "2026-10-07T00:00:00.000Z"), query: remote.query };
    const result = shoppingImportOperation({ version: 2, items: [remote] }, local);
    expect(result?.item).toMatchObject({
      id: remote.id,
      quantity: { amount: 8 },
      createdAt: remote.createdAt,
    });
    expect(
      shoppingImportOperation(
        { version: 2, items: [remote] },
        { ...local, updatedAt: remote.updatedAt },
      ),
    ).toBeNull();
    expect(
      shoppingImportOperation(
        { version: 2, items: [remote] },
        { ...local, updatedAt: "2026-10-02T00:00:00.000Z" },
      ),
    ).toBeNull();
  });
  it("matches IDs first and normalizes generic evidence before deduplication", () => {
    const remote = { ...item(1), query: "huevos", label: "Huevos" };
    expect(
      shoppingImportOperation(
        { version: 2, items: [remote] },
        { ...remote, query: "arroz", updatedAt: "2026-10-07T00:00:00.000Z" },
      )?.item.id,
    ).toBe(remote.id);
    expect(
      shoppingImportOperation({ version: 2, items: [remote] }, { ...item(2), query: "  HUEVOS  " }),
    ).toBeNull();
  });
  it("fills remaining capacity in anonymous order, allows updates at capacity and rejects identity collisions", () => {
    const items = Array.from({ length: 49 }, (_, n) => item(n + 1));
    const result = planShoppingImport(
      { version: 2, items },
      { version: 2, items: [item(50), item(51)] },
    );
    expect(result.operations).toHaveLength(1);
    expect(result.rejected.map((i) => i.id)).toEqual([item(51).id]);
    expect(
      shoppingImportOperation(result.list, item(1, 2, "2026-10-07T00:00:00.000Z")),
    ).not.toBeNull();
    expect(() =>
      shoppingImportOperation(
        { version: 2, items: [item(1), item(2)] },
        { ...item(1), query: item(2).query, updatedAt: "2026-10-07T00:00:00.000Z" },
      ),
    ).toThrow("Ya tienes esta necesidad");
  });
});
