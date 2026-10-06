import { describe, expect, it } from "vitest";
import {
  areSafeSubstitutes,
  getSubstitutionProfile,
  inferGenericSubstitutionProfile,
} from "./substitution-compatibility.ts";

describe("conservative substitution policy", () => {
  it.each([
    ["Huevos Blancos Bell's 30un", "Huevos Pardos La Calera 15un", true],
    ["Huevos Bell's 30un", "Huevos de Codorniz Bell's 24un", false],
    ["Huevos Bell's 30un", "Huevos de Codornices 30un", false],
    ["Huevos Bell's 30un", "Huevos orgánicos 30un", false],
    ["Huevos Bell's 30un", "Huevos Gallinas Libres 30un", false],
    ["Huevos Bell's 30un", "Huevos Premium 30un", false],
    ["Arroz Blanco Costeño 1kg", "Arroz Superior Añejo Faraón 5kg", true],
    ["Arroz Blanco 1kg", "Arroz Basmati 1kg", false],
    ["Arroz Blanco 1kg", "Arroz Integral 1kg", false],
    ["Aceite Vegetal 1L", "Aceite de Soya 900ml", true],
    ["Aceite de Girasol 1L", "Aceite de Girasol 900ml", true],
    ["Aceite Vegetal 1L", "Aceite Girasol 1L", false],
    ["Aceite Vegetal 1L", "Aceite de Oliva 1L", false],
    ["Detergente en Polvo Sapolio 1kg", "Detergente en Polvo Bolívar 2kg", true],
    ["Detergente en Polvo 1kg", "Detergente Líquido 1L", false],
    ["Detergente en Polvo 1kg", "Detergente Pods 30un", false],
    ["Detergente Líquido 1L", "Detergente Cápsulas 30un", false],
    ["Detergente Líquido 1L", "Detergente Líquido Matic 1L", false],
    ["Leche Entera Gloria 1L", "Leche Entera Laive 1L", false],
  ])("%s vs %s => %s", (a, b, safe) => {
    expect(areSafeSubstitutes({ title: a }, { title: b })).toBe(safe);
  });
  it("honors existing negative catalog family evidence", () => {
    expect(
      getSubstitutionProfile({
        title: "Huevos 30un",
        family: { family: null, origin: null, evidence: "category-mismatch" },
      }),
    ).toBeNull();
  });
  it("withholds uncertain generic contexts", () => {
    for (const query of [
      "leche",
      "huevos de codorniz",
      "arroz basmati",
      "aceite de oliva",
      "detergente pods",
    ]) {
      expect(inferGenericSubstitutionProfile(query, "unit")).toBeNull();
    }
  });
});
