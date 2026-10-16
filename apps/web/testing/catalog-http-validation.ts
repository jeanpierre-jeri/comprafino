import { createHash } from "node:crypto";
import { shoppingListEvaluationSchema } from "@comprafino/core";

export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function evaluationDigest(value: unknown) {
  const {
    evaluatedAt: _evaluatedAt,
    timings: _timings,
    ...decisions
  } = shoppingListEvaluationSchema.parse(value);
  return digest(decisions);
}

export type SearchExpectation = {
  ids: string[];
  groups: string[][];
  prices: { id: string; ordinary: string; conditional: string[] }[];
  totalOffers: number;
  page: number;
  hasMore: boolean;
};

/** Validate the completed HTML, including streamed error UI returned with HTTP 200. */
export function validateSearchHtml(html: string, expected: SearchExpectation) {
  if (
    !html.includes("</html>") ||
    !html.includes('aria-label="Resultados de búsqueda"') ||
    html.includes("No pudimos cargar los precios.") ||
    /:E\{"digest"/u.test(html)
  ) {
    throw new Error("Incomplete or failed search HTML");
  }
  const articles = [
    ...html.matchAll(/<article data-offer-id="([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/article>/gu),
  ];
  const ids = articles.map((match) => match[1]!);
  // React can flush sibling groups in separate segments. Wire order is not DOM
  // order across groups; validate the complete selection and each comparable group.
  if (
    digest([...ids].sort((left, right) => left.localeCompare(right))) !==
      digest([...expected.ids].sort((left, right) => left.localeCompare(right))) ||
    expected.groups.some(
      (group) => digest(ids.filter((id) => group.includes(id ?? ""))) !== digest(group),
    )
  ) {
    throw new Error("HTTP search IDs/order differ from the production reader");
  }
  for (const price of expected.prices) {
    const article = articles.find((match) => match[1] === price.id)?.[2] ?? "";
    // React can place comment boundaries between adjacent text nodes.
    const content = article.replaceAll(/<!--[\s\S]*?-->/gu, "").replaceAll("&nbsp;", "\u00a0");
    if (
      !content.includes(`class="card-amount">${price.ordinary}`) ||
      price.conditional.some((amount) => !content.includes(`Con CMR: ${amount}`))
    ) {
      throw new Error("HTTP displayed ordinary/conditional price differs from the reader");
    }
  }
  if (expected.page > 1 || expected.hasMore) {
    const text = html.replaceAll(/<!--[\s\S]*?-->/gu, "");
    if (!text.includes(`Página ${expected.page} · ${expected.totalOffers} opciones de tienda`)) {
      throw new Error("HTTP search pagination differs from the reader");
    }
  }
  if (
    !expected.ids.length &&
    !html.includes("No encontramos ese producto todavía.") &&
    !html.includes("No hay opciones con")
  ) {
    throw new Error("HTTP search empty state missing");
  }
  return { ids, totalOffers: expected.totalOffers };
}

export function percentiles(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return {
    min: ordered[0] ?? null,
    p50: ordered[Math.ceil(ordered.length * 0.5) - 1] ?? null,
    p95: ordered.length >= 20 ? ordered[Math.ceil(ordered.length * 0.95) - 1] : null,
    max: ordered.at(-1) ?? null,
  };
}
