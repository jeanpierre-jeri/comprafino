import {
  inferGenericSubstitutionProfile,
  isListingCompatibleWithGenericNeed,
} from "./substitution-compatibility.ts";
import { describe, expect, it } from "vitest";
import {
  emptyShoppingList,
  evaluateShoppingListItem,
  parseShoppingList,
  removeShoppingItem,
  saveShoppingItem,
  serializeShoppingList,
  shoppingCompatibilityKey,
  shoppingMarketQuery,
  shoppingListItemSchema,
} from "./shopping-list.ts";
import type { ShoppingCandidate, ShoppingListItem } from "./shopping-list.ts";

const now = new Date("2026-10-04T12:00:00Z");

const canonicalId = "00000000-0000-4000-8000-000000000001";

function item(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return shoppingListItemSchema.parse({
    id: "00000000-0000-4000-8000-000000000002",
    intent: "generic",
    canonicalId: null,
    query: "huevos",
    label: "Huevos",
    quantity: { amount: 30, unit: "unit" },
    frequency: "weekly",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    substitutionProfile: inferGenericSubstitutionProfile(
      overrides.query ?? "huevos",
      overrides.quantity?.unit ?? "unit",
    ),
    ...overrides,
  });
}

function candidate(overrides: Partial<ShoppingCandidate> = {}): ShoppingCandidate {
  return {
    id: "bells",
    canonicalId,
    title: "Huevos Bell's 30 un",
    retailerName: "Metro",
    url: "https://www.metro.pe/huevos/p",
    ordinaryPriceCents: 1790,
    conditionalOffers: [],
    observedAt: now,
    available: true,
    packageQuantity: { amount: 30, unit: "unit" },
    strongQuantity: true,
    ...overrides,
  };
}

const evaluate = (i: ShoppingListItem, cs: ShoppingCandidate[]) =>
  evaluateShoppingListItem(i, cs, "standard", now, "Huevos Bell's 30 un");

describe("versioned shopping persistence", () => {
  it.each([
    ["huevos tottus", "Huevos", "huevos", "eggs:regular", "unit"],
    ["huevos metro", "Huevos", "huevos", "eggs:regular", "unit"],
    ["huevos de codorniz", "Huevos de codorniz", "huevos de codorniz", null, "unit"],
    ["arroz integral", "Arroz integral", "arroz integral", null, "kg"],
    ["aceite de oliva", "Aceite de oliva", "aceite de oliva", null, "L"],
    ["huevos Bell's 30un", "Huevos", "huevos", "eggs:regular", "unit"],
  ] as const)(
    "persists the semantic generic need for %s",
    (search, label, query, profile, unit) => {
      const original = item({ query: search, label: search, quantity: { amount: 1, unit } });
      const list = saveShoppingItem(emptyShoppingList(), original);
      const persisted = parseShoppingList(serializeShoppingList(list)).list.items[0]!;
      expect(persisted).toMatchObject({
        label,
        query,
        substitutionProfile: profile,
        intent: "generic",
        canonicalId: null,
      });
      expect(original.query).toBe(search);
      expect(isListingCompatibleWithGenericNeed(persisted, candidate())).toBe(profile !== null);
    },
  );
  it("normalizes safe queries while preserving custom labels and withheld evidence", () => {
    const custom = saveShoppingItem(
      emptyShoppingList(),
      item({ query: "huevos tottus", label: "Huevos para el desayuno" }),
    ).items[0]!;
    expect(custom).toMatchObject({
      query: "huevos",
      label: "Huevos para el desayuno",
      substitutionProfile: "eggs:regular",
    });
    const withheld = saveShoppingItem(
      emptyShoppingList(),
      item({ query: "huevos tottus", label: "huevos tottus", substitutionProfile: null }),
    ).items[0]!;
    expect(withheld).toMatchObject({ query: "huevos tottus", substitutionProfile: null });
  });
  it("loads empty, valid, malformed and unknown versions safely", () => {
    expect(parseShoppingList(null)).toEqual({ list: emptyShoppingList(), invalid: false });
    const list = saveShoppingItem(emptyShoppingList(), item());
    const serialized = serializeShoppingList(list);
    expect(parseShoppingList(serialized)).toEqual({ list, invalid: false });
    expect(serializeShoppingList(parseShoppingList(serialized).list)).toBe(serialized);

    for (const raw of [
      "{",
      "null",
      '{"version":0,"items":[]}',
      '{"version":3,"items":[]}',
      '{"version":1,"items":[{}]}',
    ]) {
      expect(parseShoppingList(raw)).toEqual({ list: emptyShoppingList(), invalid: true });
    }
  });
  it("adds, edits, removes and preserves identity on duplicate add", () => {
    let list = saveShoppingItem(emptyShoppingList(), item());
    list = saveShoppingItem(
      list,
      item({
        id: canonicalId,
        query: "  Huevos  ",
        quantity: { amount: 60, unit: "unit" },
        frequency: "monthly",
        createdAt: "2026-10-05T12:00:00Z",
      }),
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: item().id,
      createdAt: now.toISOString(),
      frequency: "monthly",
      quantity: { amount: 60 },
    });
    list = saveShoppingItem(list, item({ frequency: "biweekly" }));
    expect(list.items[0]?.frequency).toBe("biweekly");
    expect(removeShoppingItem(list, item().id)).toEqual(emptyShoppingList());
  });
  it("deduplicates specific intents but keeps genuinely different modes", () => {
    let list = saveShoppingItem(emptyShoppingList(), item({ intent: "strict", canonicalId }));
    list = saveShoppingItem(list, item({ id: canonicalId, intent: "strict", canonicalId }));
    expect(list.items).toHaveLength(1);
    list = saveShoppingItem(list, item({ id: canonicalId, intent: "preferred", canonicalId }));
    expect(list.items).toHaveLength(2);
    expect(() => saveShoppingItem(list, item({ intent: "preferred", canonicalId }))).toThrow(
      "Ya tienes",
    );
  });
  it("validates dimensions, positive quantities, whole counts and specific IDs", () => {
    for (const quantity of [
      { amount: 0, unit: "unit" },
      { amount: 1.5, unit: "unit" },
      { amount: 1, unit: "roll" },
      { amount: 1.1234, unit: "kg" },
    ]) {
      expect(shoppingListItemSchema.safeParse({ ...item(), quantity }).success).toBe(false);
    }

    expect(shoppingListItemSchema.safeParse({ ...item(), intent: "strict" }).success).toBe(false);
  });
});

describe("shopping quantity and ranking", () => {
  it("uses integer packages for exact fit, multiples and unavoidable overbuy", () => {
    expect(evaluate(item(), [candidate()]).best).toMatchObject({
      packages: 1,
      purchasedQuantity: 30,
      totalCostCents: 1790,
      overbuy: 0,
    });
    expect(
      evaluate(item(), [
        candidate({ packageQuantity: { amount: 15, unit: "unit" }, ordinaryPriceCents: 890 }),
      ]).best,
    ).toMatchObject({ packages: 2, totalCostCents: 1780 });
    expect(
      evaluate(item(), [
        candidate({ packageQuantity: { amount: 12, unit: "unit" }, ordinaryPriceCents: 800 }),
      ]).best,
    ).toMatchObject({ packages: 3, purchasedQuantity: 36, totalCostCents: 2400, overbuy: 6 });
  });
  it("excludes excessive bulk overbuy, weak quantities and unsupported dimensions", () => {
    const need = item({ query: "arroz", quantity: { amount: 1, unit: "kg" } });
    expect(
      evaluate(need, [
        candidate({
          title: "Arroz Blanco 5kg",
          packageQuantity: { amount: 5, unit: "kg" },
          ordinaryPriceCents: 100,
        }),
      ]).best,
    ).toBeNull();
    expect(
      evaluate(item(), [
        candidate({ strongQuantity: false }),
        candidate({ packageQuantity: { amount: 1, unit: "kg" } }),
      ]).best,
    ).toBeNull();
  });
  it("supports mass, volume and decimal needs without fractional packages", () => {
    expect(
      evaluate(item({ query: "arroz", quantity: { amount: 5, unit: "kg" } }), [
        candidate({
          title: "Arroz Blanco 1kg",
          packageQuantity: { amount: 1, unit: "kg" },
          ordinaryPriceCents: 400,
        }),
      ]).best,
    ).toMatchObject({ packages: 5, purchasedQuantity: 5, totalCostCents: 2000 });
    expect(
      evaluate(item({ query: "aceite", quantity: { amount: 3, unit: "L" } }), [
        candidate({
          title: "Aceite Vegetal 900ml",
          packageQuantity: { amount: 0.9, unit: "L" },
          ordinaryPriceCents: 500,
        }),
      ]).best,
    ).toMatchObject({ packages: 4, purchasedQuantity: 3.6, overbuy: 0.6, totalCostCents: 2000 });
  });
  it("ranks by purchase cost, favors lower overbuy in a tie, and is deterministic", () => {
    const a = candidate({
      id: "a",
      packageQuantity: { amount: 12, unit: "unit" },
      ordinaryPriceCents: 600,
    });
    const b = candidate({ id: "b", ordinaryPriceCents: 1800 });
    expect(evaluate(item(), [a, b]).best?.id).toBe("b");
    expect(evaluate(item(), [candidate({ id: "c", ordinaryPriceCents: 1700 }), b]).best?.id).toBe(
      "c",
    );
    expect(evaluate(item(), [candidate({ id: "z" }), candidate({ id: "a" })]).best?.id).toBe("a");
  });
  it("excludes stale, future and unavailable offers", () => {
    for (const c of [
      candidate({ observedAt: new Date("2026-10-01T12:00:00Z") }),
      candidate({ observedAt: new Date("2026-10-05T12:00:00Z") }),
      candidate({ available: false }),
    ]) {
      expect(evaluate(item(), [c]).best).toBeNull();
    }
  });
  it("lets supported conditional prices compete only in benefits mode", () => {
    const c = candidate({
      conditionalOffers: [
        {
          conditionType: "payment_card",
          programKey: "cmr",
          conditionLabel: "Requiere tarjeta CMR",
          priceCents: 1490,
          observedAt: now,
        },
      ],
    });
    expect(evaluate(item(), [c]).best).toMatchObject({ totalCostCents: 1790, condition: null });
    expect(evaluateShoppingListItem(item(), [c], "benefits", now).best).toMatchObject({
      totalCostCents: 1490,
      ordinaryTotalCents: 1790,
      condition: "Requiere tarjeta CMR",
    });
    expect(
      evaluateShoppingListItem(
        item(),
        [{ ...c, conditionalOffers: [{ ...c.conditionalOffers[0]!, endsAt: now }] }],
        "benefits",
        now,
      ).best?.totalCostCents,
    ).toBe(1790);
  });
});

describe("flexible intentions and compatibility", () => {
  const alternative = candidate({
    id: "tottus",
    canonicalId: "00000000-0000-4000-8000-000000000003",
    title: "Huevos Tottus 30un",
    ordinaryPriceCents: 1490,
  });
  it("generic brand searches become flexible family needs and duplicate the same need", () => {
    const need = item({ query: "huevos Bell's 30un" });
    expect(shoppingMarketQuery(need)).toBe("huevos");
    const list = saveShoppingItem(saveShoppingItem(emptyShoppingList(), item()), {
      ...need,
      id: canonicalId,
    });
    expect(list.items).toHaveLength(1);
    expect(evaluate(need, [candidate(), alternative]).best?.id).toBe("tottus");
    expect(shoppingMarketQuery(item({ query: "huevos orgánicos" }))).toBe("huevos orgánicos");
  });
  it("generic winners change brand as current market prices change", () => {
    expect(evaluate(item(), [candidate(), alternative]).best?.id).toBe("tottus");
    expect(
      evaluate(item(), [candidate(), { ...alternative, ordinaryPriceCents: 1990 }]).best?.id,
    ).toBe("bells");
  });
  it("strict never substitutes; preferred shows a meaningful saving without mutation", () => {
    const strict = item({ intent: "strict", canonicalId });
    expect(evaluate(strict, [candidate(), alternative]).options.map((o) => o.id)).toEqual([
      "bells",
    ]);
    expect(evaluate(strict, [alternative]).best).toBeNull();
    const preferred = item({ intent: "preferred", canonicalId });
    expect(evaluate(preferred, [candidate(), alternative])).toMatchObject({
      best: { id: "bells" },
      preferred: { id: "bells" },
      alternative: { id: "tottus" },
      savingsCents: 300,
    });
    expect(
      evaluate(preferred, [candidate(), { ...alternative, ordinaryPriceCents: 1740 }]).alternative,
    ).toBeNull();
    expect(preferred.canonicalId).toBe(canonicalId);
  });
  it("does not infer compatibility from a stale stored label when a preferred SKU is missing", () => {
    expect(
      evaluateShoppingListItem(
        item({ intent: "preferred", canonicalId }),
        [alternative],
        "standard",
        now,
      ).best,
    ).toBeNull();
  });
  it("excludes premium/incompatible variants, unknown families and weak lexical matches", () => {
    for (const title of [
      "Huevos orgánicos 30un",
      "Huevos de codorniz 30un",
      "Chocolate huevos 30un",
      "Arroz basmati 1kg",
      "Arroz integral 1kg",
      "Atún 170g",
      "Leche Gloria 946ml",
      "Detergente pods 30un",
      "Aceite de oliva 1L",
    ]) {
      expect(shoppingCompatibilityKey(title)).toBeNull();
    }

    expect(evaluate(item(), [candidate({ title: "Huevos premium 30un" })]).best).toBeNull();
    expect(shoppingCompatibilityKey("Detergente líquido 1L")).not.toBe(
      shoppingCompatibilityKey("Detergente en polvo 1kg"),
    );
  });
  it("allows verified independent generic brands without inventing exact canonical identity", () => {
    expect(evaluate(item(), [candidate({ canonicalId: null })]).best).toMatchObject({
      canonicalId: null,
      totalCostCents: 1790,
    });
    expect(
      evaluate(item({ intent: "strict", canonicalId }), [candidate({ canonicalId: null })]).best,
    ).toBeNull();
  });
  it("keeps specialty detergent and machine variants out of ordinary alternatives", () => {
    for (const title of [
      "Detergente en Polvo Baby Kids 1kg",
      "Detergente en Polvo Cuidado Bebés 1kg",
      "Detergente en Polvo Cuidado Micelar 1kg",
    ]) {
      expect(shoppingCompatibilityKey(title)).toBeNull();
    }

    expect(shoppingCompatibilityKey("Detergente Líquido Matic 1L")).not.toBe(
      shoppingCompatibilityKey("Detergente Líquido 1L"),
    );
  });
  it("specific milk can count whole containers while generic milk stays unsupported", () => {
    const c = candidate({
      title: "Leche Gloria 946ml",
      packageQuantity: { amount: 0.946, unit: "L" },
    });
    expect(
      evaluate(item({ intent: "strict", canonicalId, quantity: { amount: 6, unit: "unit" } }), [c])
        .best,
    ).toMatchObject({ packages: 6, purchasedQuantity: 6 });
    expect(
      evaluate(item({ query: "leche", quantity: { amount: 6, unit: "unit" } }), [c]).best,
    ).toBeNull();
  });
});

describe("Milestone 15.1 quantity and migration boundaries", () => {
  it("migrates all intents and custom labels without guessing package sizes", () => {
    const originals = [
      item(),
      item({ id: canonicalId, intent: "preferred", canonicalId, label: "Mis huevos favoritos" }),
      item({
        id: "00000000-0000-4000-8000-000000000003",
        intent: "strict",
        canonicalId,
        quantity: { amount: 2, unit: "kg" },
      }),
    ];
    const legacy = originals.map(
      ({ quantityMode: _mode, substitutionProfile: _profile, ...old }) => old,
    );
    const migrated = parseShoppingList(JSON.stringify({ version: 1, items: legacy }));
    expect(migrated.invalid).toBe(false);
    expect(migrated.list.version).toBe(2);
    expect(migrated.list.items.map((i) => i.quantity)).toEqual(originals.map((i) => i.quantity));
    expect(migrated.list.items.map((i) => i.label)).toEqual(originals.map((i) => i.label));
    expect(migrated.list.items.map((i) => i.quantityMode)).toEqual([
      "normalized",
      "normalized",
      "normalized",
    ]);
    expect(migrated.list.items[0]?.substitutionProfile).toBe("eggs:regular");
    expect(parseShoppingList(serializeShoppingList(migrated.list))).toEqual(migrated);
  });
  it("preserves unsupported old generic needs but withholds recommendations", () => {
    const old = item({ query: "leche", label: "Leche personalizada" });
    const result = parseShoppingList(JSON.stringify({ version: 1, items: [old] }));
    expect(result.list.items[0]?.label).toBe("Leche personalizada");
    expect(result.list.items[0]?.substitutionProfile).toBeNull();
    expect(
      evaluate(result.list.items[0]!, [candidate({ title: "Leche Gloria 1L" })]).best,
    ).toBeNull();
    expect(evaluate(item({ substitutionProfile: null }), [candidate()]).best).toBeNull();
    expect(
      evaluate(item({ query: "leche", substitutionProfile: "eggs:regular" }), [candidate()]).best,
    ).toBeNull();
  });
  it.each(["preferred", "strict"] as const)(
    "%s exact eggs count sale packages rather than contained eggs",
    (intent) => {
      const need = item({
        intent,
        canonicalId,
        quantityMode: "packages",
        quantity: { amount: 2, unit: "unit" },
      });
      const result = evaluate(need, [candidate()]);
      expect(result.best).toMatchObject({
        packages: 2,
        purchasedQuantity: 2,
        countsPackages: true,
        totalCostCents: 3580,
      });
    },
  );
  it("preferred alternatives fulfill the contents of the requested exact packages", () => {
    const need = item({
      intent: "preferred",
      canonicalId,
      quantityMode: "packages",
      quantity: { amount: 2, unit: "unit" },
    });
    const other = candidate({
      id: "other",
      canonicalId: null,
      title: "Huevos Tottus 15un",
      packageQuantity: { amount: 15, unit: "unit" },
      ordinaryPriceCents: 700,
    });
    expect(evaluate(need, [candidate(), other]).alternative).toMatchObject({
      packages: 4,
      purchasedQuantity: 60,
      countsPackages: false,
      quantityUnit: "unit",
      totalCostCents: 2800,
    });
    expect(evaluate(need, [other]).alternative).toBeNull();
  });
  it("two exact 1kg rice packages mean 2kg for safe alternative fulfillment", () => {
    const need = item({
      intent: "preferred",
      canonicalId,
      query: "arroz",
      quantityMode: "packages",
      quantity: { amount: 2, unit: "unit" },
    });
    const base = candidate({
      title: "Arroz Blanco 1kg",
      ordinaryPriceCents: 600,
      packageQuantity: { amount: 1, unit: "kg" },
    });
    const other = candidate({
      id: "other",
      canonicalId: null,
      title: "Arroz Blanco 500g",
      ordinaryPriceCents: 200,
      packageQuantity: { amount: 0.5, unit: "kg" },
    });
    const result = evaluateShoppingListItem(need, [base, other], "standard", now, base.title);
    expect(result.preferred).toMatchObject({ packages: 2, totalCostCents: 1200 });
    expect(result.alternative).toMatchObject({
      packages: 4,
      purchasedQuantity: 2,
      quantityUnit: "kg",
      totalCostCents: 800,
    });
  });
  it("never treats a direct kg quote as the price of an exact sale package", () => {
    const need = item({
      intent: "strict",
      canonicalId,
      quantityMode: "packages",
      quantity: { amount: 2, unit: "unit" },
    });
    expect(
      evaluate(need, [candidate({ pricingBasis: "kg", packageQuantity: null })]).best,
    ).toBeNull();
    expect(
      evaluate(need, [
        candidate({ pricingBasis: "unit", packageQuantity: null, strongQuantity: false }),
      ]).best,
    ).toMatchObject({ packages: 2, totalCostCents: 3580 });
  });
  it("rejects fractional package counts and generic package semantics", () => {
    expect(
      shoppingListItemSchema.safeParse({
        ...item({ intent: "strict", canonicalId }),
        quantityMode: "packages",
        quantity: { amount: 1.5, unit: "kg" },
      }).success,
    ).toBe(false);
    expect(shoppingListItemSchema.safeParse({ ...item(), quantityMode: "packages" }).success).toBe(
      false,
    );
  });
});

it("zero ordinary prices cannot fulfill generic or exact shopping needs", () => {
  for (const intent of ["generic", "preferred", "strict"] as const) {
    const need = item(
      intent === "generic" ? { intent, canonicalId: null } : { intent, canonicalId },
    );
    const result = evaluate(need, [
      candidate({ ordinaryPriceCents: 0 }),
      candidate({ id: "paid" }),
    ]);
    expect(result.options.map((o) => o.id)).toEqual(["paid"]);
  }
});
