"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchFilters, searchFilterQuery } from "@comprafino/db/search-filters";
import type { SearchFilters } from "@comprafino/db/search-filters";

export function SearchControls({
  query,
  filters,
  units = [],
  comparisonPath,
}: {
  query: string;
  filters: SearchFilters;
  units?: string[];
  comparisonPath?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function change(key: string, value: string) {
    const next = searchFilters({ ...filters, [key]: value });
    const suffix = comparisonPath
      ? next.priceMode === "benefits"
        ? "?priceMode=benefits"
        : ""
      : `?${searchFilterQuery(query, next)}`;
    startTransition(() =>
      router.push(`${comparisonPath ?? "/search"}${suffix}`, { scroll: false }),
    );
  }
  const controlClass =
    "mt-1 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <div className="my-5 rounded-xl border bg-muted/30 p-3" aria-busy={pending}>
      <fieldset
        disabled={pending}
        className={`grid gap-3 ${comparisonPath ? "" : "grid-cols-2 lg:grid-cols-4"}`}
      >
        <legend className="sr-only">Filtros de precios</legend>
        {!comparisonPath && (
          <>
            <label className="min-w-0 text-xs font-medium">
              Ordenar
              <select
                aria-label="Ordenar"
                value={filters.sort}
                onChange={(e) => change("sort", e.target.value)}
                className={controlClass}
              >
                <option value="relevance">Relevancia</option>
                <option value="total-price">Menor precio total</option>
                <option value="unit-price">Mejor precio por unidad</option>
              </select>
            </label>
            <label className="min-w-0 text-xs font-medium">
              Supermercado
              <select
                value={filters.retailer ?? ""}
                onChange={(e) => change("retailer", e.target.value)}
                className={controlClass}
              >
                <option value="">Todos</option>
                <option value="tottus">Tottus</option>
                <option value="plaza-vea">Plaza Vea</option>
                <option value="metro">Metro</option>
              </select>
            </label>
            {(units.length > 1 || filters.unit) && (
              <label className="min-w-0 text-xs font-medium">
                Comparar por
                <select
                  value={filters.unit ?? ""}
                  onChange={(e) => change("unit", e.target.value)}
                  className={controlClass}
                >
                  <option value="">Todas las medidas</option>
                  {[...new Set([...units, ...(filters.unit ? [filters.unit] : [])])].map((unit) => (
                    <option key={unit} value={unit}>
                      {unit === "kg"
                        ? "kg"
                        : unit === "L"
                          ? "litro"
                          : unit === "roll"
                            ? "rollo · orientativo"
                            : "unidad"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label className="min-w-0 text-xs font-medium">
          Precios
          <select
            value={filters.priceMode}
            onChange={(e) => change("priceMode", e.target.value)}
            className={controlClass}
          >
            <option value="standard">Para todos</option>
            <option value="benefits">Incluir beneficios</option>
          </select>
        </label>
      </fieldset>
      <output className="mt-2 text-xs text-muted-foreground">
        {pending
          ? "Actualizando resultados…"
          : filters.priceMode === "benefits"
            ? "Incluye ofertas que requieren tarjeta CMR. Verifica la condición antes de comprar."
            : "Los precios para todos determinan el orden. Los beneficios se muestran por separado."}
      </output>
    </div>
  );
}
