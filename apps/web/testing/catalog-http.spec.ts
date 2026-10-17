import { expect, test } from "@playwright/test";
import { percentiles, validateSearchHtml } from "./catalog-http-validation.ts";
import {
  catalogBasketCases,
  catalogSearchCases,
  makeCatalogList,
} from "./catalog-benchmark-workloads.ts";
import { randomUUID } from "node:crypto";

const id = "00000000-0000-4000-8000-000000000001";
const expected = {
  ids: [id],
  groups: [[id]],
  prices: [{ id, ordinary: "S/ 5.00", conditional: ["S/ 4.00"] }],
  totalProducts: 31,
  totalOffers: 31,
  page: 1,
  hasMore: true,
};
const html = `<html><section aria-label="Resultados de búsqueda"><article data-product-id="${id}" class="product-card"><p class="card-amount">Desde S/ 5.00</p><p>Con CMR: <!-- -->S/ 4.00</p></article>Página <!-- -->1<!-- --> · <!-- -->31<!-- --> productos · 31 ofertas de tienda</section></html>`;

test("HTTP benchmark validates streamed search IDs, prices and pagination", () => {
  expect(validateSearchHtml(html, expected).ids).toEqual([id]);
  expect(() => validateSearchHtml(html.replace("S/ 5.00", "S/ 0.00"), expected)).toThrow(
    "price differs",
  );
  expect(() => validateSearchHtml(html.replace("31", "30"), expected)).toThrow(
    "pagination differs",
  );
  expect(() => validateSearchHtml(html.replace(id, randomUUID()), expected)).toThrow(
    "IDs/order differ",
  );
});

test("HTTP benchmark rejects 200 error UI and truncated HTML", () => {
  expect(() =>
    validateSearchHtml(
      html.replace("</section>", "No pudimos cargar los precios.</section>"),
      expected,
    ),
  ).toThrow("failed search");
  expect(() => validateSearchHtml(html.replace("</html>", ""), expected)).toThrow("Incomplete");
  expect(() =>
    validateSearchHtml('<html><section aria-label="Resultados de búsqueda"></section></html>', {
      ids: [],
      groups: [],
      prices: [],
      page: 1,
      hasMore: false,
      totalProducts: 0,
      totalOffers: 0,
    }),
  ).toThrow("empty state");
});

test("HTTP percentiles do not turn small samples or no successes into p95", () => {
  expect(percentiles([])).toEqual({ min: null, p50: null, p95: null, max: null });
  expect(percentiles([1, 2]).p95).toBeNull();
  expect(percentiles(Array.from({ length: 20 }, (_, index) => index + 1))).toEqual({
    min: 1,
    p50: 10,
    p95: 19,
    max: 20,
  });
});

test("reader and HTTP runners share the original workload sizes and intents", () => {
  expect(catalogSearchCases()).toHaveLength(12);
  expect(catalogBasketCases()).toHaveLength(8);
  const now = new Date("2026-10-16T12:00:00Z");
  const exactIds = Array.from({ length: 50 }, () => randomUUID());
  const mixed = makeCatalogList(now, exactIds, 20);
  expect(mixed.items.filter((item) => item.intent === "generic")).toHaveLength(5);
  expect(
    makeCatalogList(now, exactIds, 5, "generic").items.every((item) => item.intent === "generic"),
  ).toBe(true);
  expect(
    makeCatalogList(now, exactIds, 50, "strict").items.every((item) => item.intent === "strict"),
  ).toBe(true);
});

test("HTTP search validation permits streaming group interleaving but rejects within-group reorder", () => {
  const second = "00000000-0000-4000-8000-000000000002";
  const third = "00000000-0000-4000-8000-000000000003";
  const article = (key: string) => `<article data-product-id="${key}"></article>`;
  const stream = `<html><section aria-label="Resultados de búsqueda">${article(id)}${article(third)}${article(second)}</section></html>`;
  const reference = {
    ids: [id, second, third],
    groups: [[id, second], [third]],
    prices: [],
    page: 1,
    hasMore: false,
    totalProducts: 3,
    totalOffers: 3,
  };
  expect(validateSearchHtml(stream, reference).ids).toEqual([id, third, second]);
  expect(() =>
    validateSearchHtml(stream, { ...reference, groups: [[second, id], [third]] }),
  ).toThrow("IDs/order differ");
});
