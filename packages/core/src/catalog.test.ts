import { describe, expect, it } from "vitest";
import {
  normalizeCatalogListing,
  normalizeTitle,
  normalizeUnit,
  toBaseQuantity,
} from "./catalog.ts";
import type { CatalogInput } from "./catalog.ts";

const normalize = (title: string, hints: Partial<CatalogInput> = {}) =>
  normalizeCatalogListing({ title, priceUnit: "UN", ...hints });

// Titles from persisted listings/fixtures; additional syntax cases are explicitly synthetic.
describe("catalog quantities and packs", () => {
  it.each([
    ["Carne Molida De Res x 500 g", 500, "g", 1, 500],
    ["Leche Reconstituida Entera GLORIA Lata 390g Paquete 6un", 390, "g", 6, 2340],
    ["Leche UHT GLORIA Zero Lacto Caja 946ml", 946, "ml", 1, 946],
    ["Yogurt Bebible Gloria Fresa Galonera 1.6kg", 1600, "g", 1, 1600],
    ["Tripack Leche UHT Sin Lactosa Gloria Zero Lacto Caja 946ml", 946, "ml", 3, 2838],
    ["Fourpack Leche Semidescremada UHT Laive Sin Lactosa Caja 946ml", 946, "ml", 4, 3784],
    ["Sixpack Leche Reconstituida Gloria Lata 390g", 390, "g", 6, 2340],
    ["Leche UHT Entera Gloria Pack 3 Cajas 946 mL", 946, "ml", 3, 2838],
    ["Huevos Pardos BELL'S Bandeja 30un", 30, "unit", 1, 30],
    ["Huevos Pardos LA CALERA Paquete 30un", 30, "unit", 1, 30],
    // Synthetic syntax/conversion variants, not captured live observations.
    ["Producto 1 kg", 1000, "g", 1, 1000],
    ["Producto 1.5 kg", 1500, "g", 1, 1500],
    ["Producto 1 L", 1000, "ml", 1, 1000],
    ["Producto 1,5 litros", 1500, "ml", 1, 1500],
    ["Producto 6un", 6, "unit", 1, 6],
    ["Producto 6 und", 6, "unit", 1, 6],
    ["Producto 6 x 390 g", 390, "g", 6, 2340],
    ["Leche 390g x 6", 390, "g", 6, 2340],
    ["Leche pack x6 390g", 390, "g", 6, 2340],
    ["Leche pack x 500 g", 500, "g", null, null],
  ] as const)("normalizes %s", (title, value, unit, count, total) => {
    const a = normalize(title);
    expect(a.quantity).toEqual({ value, unit });
    expect(a.packageCount).toBe(count);
    expect(a.totalQuantity).toEqual(total === null ? null : { value: total, unit });
    expect(normalize(title)).toEqual(a);
  });
  it("prefers package descriptions over title but records conflicts", () => {
    const a = normalize("Leche Gloria 1 L Paquete 3un", { packageText: "Caja 946ml Paquete 6un" });
    expect(a.quantity).toEqual({ value: 946, unit: "ml" });
    expect(a.packageCount).toBe(6);
    expect(a.totalQuantity?.value).toBe(5676);
    expect(a.issues).toEqual(["source-title-quantity-conflict", "source-title-count-conflict"]);
  });
  it("prefers verified structured hints without coupling to a retailer API", () => {
    const a = normalize("Leche Gloria 1 L", {
      sourceQuantity: { value: "0.946", unit: "l" },
      sourcePackageCount: 3,
    });
    expect(a.quantity).toEqual({ value: 946, unit: "ml" });
    expect(a.totalQuantity).toEqual({ value: 2838, unit: "ml" });
  });
  it("never treats source sale multipliers as package counts", () => {
    expect(normalize("Leche Gloria 390g", { sourceUnitMultiplier: 1 }).packageCount).toBe(1);
    const a = normalize("Pollo Fresco con Menudencia San Fernando x kg", {
      priceUnit: "KG",
      packageText: "unitMultiplier: 1.9 kg",
      sourceUnitMultiplier: 1.9,
    });
    expect(a).toMatchObject({
      soldByWeight: true,
      pricingBasis: "kg",
      quantity: null,
      packageCount: null,
      totalQuantity: null,
    });
  });
  it("keeps pricing basis separate from mass and approximate descriptions", () => {
    expect(normalize("Carne Molida De Res x 500 g")).toMatchObject({
      pricingBasis: "unit",
      soldByWeight: false,
      quantity: { value: 500, unit: "g" },
    });
    expect(
      normalize("Carne Molida De Res x 500 g", { packageText: "Empaque 500 g Aprox" }),
    ).toMatchObject({ quantity: null, totalQuantity: null, issues: ["approximate-quantity"] });
    expect(
      normalize("Pollo Fresco Con Menudencia Tottus", {
        priceUnit: "KG",
        packageText: "2.3 Kg Aprox",
      }).quantity,
    ).toBeNull();
  });
  it.each([
    "Producto",
    "Producto x 6",
    "Leche Gloria 500g / 1kg",
    "Queso Edam Laive + Jamón Americano Suiza 300g",
    "Producto -500g",
    "Producto 0.1g",
  ])("declines uncertain quantity: %s", (title) => {
    expect(normalize(title).quantity).toBeNull();
    expect(normalize(title).totalQuantity).toBeNull();
  });
  it.each(["Pack leche 390g", "Tripack leche Gloria 390g x 6"])(
    "declines uncertain package count: %s",
    (title) => {
      expect(normalize(title).packageCount).toBeNull();
      expect(normalize(title).totalQuantity).toBeNull();
    },
  );
  it("retains count without inventing per-item mass for pack x6", () => {
    expect(normalize("Pack x6 Leche Evaporada Gloria Entera")).toMatchObject({
      quantity: null,
      packageCount: 6,
      totalQuantity: null,
    });
  });
  it("does not confuse promotion or price digits with attributes", () => {
    expect(
      normalize("Leche Gloria 390g", { packageText: "ListPrice: 24.60; Price: 21.50" }).quantity,
    ).toEqual({ value: 390, unit: "g" });
    expect(normalize("Leche Gloria 390g 2x1").packageCount).toBe(1);
  });
  it("refuses totals outside PostgreSQL integer range", () => {
    const a = normalize("Producto 2147483647g", { sourcePackageCount: 2 });
    expect(a.totalQuantity).toBeNull();
    expect(a.issues).toContain("total-overflow");
  });
});

describe("brand and title normalization", () => {
  it.each([
    ["GLORIA Leche 390g", "Gloria"],
    ["Huevos Pardos BELL'S Bandeja 30un", "Bell's"],
    ["Pollo Fresco Con Menudencia Tottus", "Tottus"],
    ["Leche Metro 1 L", "Metro"],
    ["Mezcla Láctea BONLÉ 480g", "Bonlé"],
    ["Queso Cuisine & Co 410g", "Cuisine & Co"],
    ["Desconocida leche 1 L", null],
    ["Queso Laive + Jamón Suiza 300g", null],
  ])("extracts only observed brands in %s", (title, brand) => {
    expect(normalize(title).brand).toBe(brand);
  });
  it("prefers structured brands, retains meaningful punctuation and accepts missing brands", () => {
    expect(normalize("Leche Gloria 390g", { sourceBrand: "  BELL’S  " })).toMatchObject({
      brand: "Bell's",
      brandKey: "bell's",
      brandSource: "source",
    });
    expect(normalize("Leche", { sourceBrand: "  NUEVA MARCA  " }).brand).toBe("Nueva Marca");
    expect(normalize("Leche", { sourceBrand: " " }).brand).toBeNull();
  });
  it("normalizes Unicode/case/separators while retaining accents, apostrophes, decimals and product numbers", () => {
    const title = "  KÉFIR\u00a0 BELL’S — 1.5 L | Modelo 2026  ";
    expect(normalizeTitle(title)).toBe("kéfir bell's - 1.5 l modelo 2026");
    expect(normalizeTitle(normalizeTitle(title))).toBe(normalizeTitle(title));
  });
  it("validates untrusted inputs", () => {
    expect(() => normalize("Leche", { sourceUnitMultiplier: -1 })).toThrow(/.+/u);
    expect(() => normalize("Leche", { sourcePackageCount: 1.5 })).toThrow(/.+/u);
  });
});

it.each([
  ["GR", "g"],
  ["gramos", "g"],
  ["KG", "kg"],
  ["kilo", "kg"],
  ["ML", "ml"],
  ["lt", "l"],
  ["litro", "l"],
  ["UN", "unit"],
  ["und", "unit"],
  ["unidades", "unit"],
  ["oz", null],
])("normalizes unit %s", (raw, expected) => {
  expect(normalizeUnit(raw)).toBe(expected);
});

it.each([
  ["0.001", "kg", 1, "g"],
  ["1.5", "l", 1500, "ml"],
  ["750", "ml", 750, "ml"],
  ["0.29", "kg", 290, "g"],
] as const)("converts %s %s exactly", (value, unit, expected, base) => {
  expect(toBaseQuantity(value, unit)).toEqual({ value: expected, unit: base });
});

it.each(["0", "-1", "1e3", "0.0001", "2147483648"])(
  "rejects invalid/nonintegral base quantities %s",
  (value) => {
    expect(toBaseQuantity(value, "g")).toBeNull();
  },
);

it("leaves both content and package count unknown when no package information exists", () => {
  expect(normalize("Producto sin descripción de envase")).toMatchObject({
    quantity: null,
    packageCount: null,
    totalQuantity: null,
  });
});

it.each([
  ["Mantequilla con Sal GLORIA Paquete 180g", "Paquete 180g", 180, "g"],
  [
    "Leche Uht Vigor Bolsa 800ml",
    "Envase: Bolsa; Formato: Líquido; Pack-Unitario: Unitario",
    800,
    "ml",
  ],
] as const)(
  "distinguishes package quantities and metadata keys from pack signals: %s",
  (title, packageText, value, unit) => {
    expect(normalize(title, { packageText })).toMatchObject({
      quantity: { value, unit },
      packageCount: 1,
      totalQuantity: { value, unit },
      issues: [],
    });
  },
);
