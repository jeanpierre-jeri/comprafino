"use client";

import { cn } from "@comprafino/ui/lib/utils";
import { ChoiceSelect } from "@comprafino/ui/components/select";
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFilters, searchFilterQuery } from "@comprafino/core/search-filters";
import type { SearchFilters } from "@comprafino/core/search-filters";

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
  const currentParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function change(key: string, value: string) {
    const next = searchFilters({ ...filters, [key]: value });
    const historyRange = currentParams.get("range");
    let suffix;

    if (comparisonPath) {
      if (next.priceMode === "benefits") {
        suffix = `?priceMode=benefits${historyRange ? `&range=${encodeURIComponent(historyRange)}` : ""}`;
      } else if (historyRange) {
        suffix = `?range=${encodeURIComponent(historyRange)}`;
      } else {
        suffix = "" as const;
      }
    } else {
      suffix = `?${searchFilterQuery(query, next)}`;
    }

    startTransition(() =>
      router.push(`${comparisonPath ?? "/search"}${suffix}`, { scroll: false }),
    );
  }

  const unitOptions = [...new Set([...units, ...(filters.unit ? [filters.unit] : [])])].map(
    (unit) => ({
      value: unit,
      label: unitOptionLabel(unit),
    }),
  );

  const showUnitFilter = units.length > 1 || Boolean(filters.unit);
  const searchColumns = showUnitFilter ? "lg:grid-cols-4" : "lg:grid-cols-3";
  const fieldsetLayout = comparisonPath
    ? "sm:max-w-sm"
    : cn("grid-cols-1 min-[380px]:grid-cols-2", searchColumns);

  return (
    <div className="filter-surface" aria-busy={pending}>
      <fieldset
        disabled={pending}
        className={cn("grid items-end gap-x-3 gap-y-2.5", fieldsetLayout)}
      >
        <legend className="sr-only">Filtros de precios</legend>
        {!comparisonPath && (
          <>
            <ChoiceSelect
              label="Ordenar"
              value={filters.sort}
              disabled={pending}
              onValueChange={(value) => change("sort", value)}
              options={[
                { value: "relevance", label: "Relevancia" },
                { value: "total-price", label: "Menor precio total" },
                { value: "unit-price", label: "Menor por unidad" },
              ]}
            />
            <ChoiceSelect
              label="Supermercado"
              value={filters.retailer ?? ""}
              disabled={pending}
              onValueChange={(value) => change("retailer", value)}
              options={[
                { value: "", label: "Todos" },
                { value: "tottus", label: "Tottus" },
                { value: "plaza-vea", label: "Plaza Vea" },
                { value: "metro", label: "Metro" },
              ]}
            />
            {(units.length > 1 || filters.unit) && (
              <ChoiceSelect
                label="Comparar por"
                value={filters.unit ?? ""}
                disabled={pending}
                onValueChange={(value) => change("unit", value)}
                options={[{ value: "", label: "Todas las medidas" }, ...unitOptions]}
              />
            )}
          </>
        )}
        <ChoiceSelect
          label="Precios"
          value={filters.priceMode}
          disabled={pending}
          className={
            !comparisonPath && units.length <= 1 && !filters.unit
              ? "min-[380px]:col-span-2 lg:col-span-1"
              : ""
          }
          onValueChange={(value) => change("priceMode", value)}
          options={[
            { value: "standard", label: "Para todos" },
            { value: "benefits", label: "Incluir beneficios" },
          ]}
        />
      </fieldset>
      <output className="mt-2.5 block text-xs leading-relaxed text-muted-foreground">
        {filterStatusMessage(pending, filters.priceMode)}
      </output>
    </div>
  );
}

function unitOptionLabel(unit: string): string {
  switch (unit) {
    case "kg":
      return "kg";
    case "L":
      return "litro";
    case "roll":
      return "rollo · orientativo";
    default:
      return "unidad";
  }
}

function filterStatusMessage(pending: boolean, priceMode: SearchFilters["priceMode"]): string {
  if (pending) return "Actualizando resultados…";

  return priceMode === "benefits"
    ? "Incluye ofertas que requieren tarjeta CMR. Verifica la condición antes de comprar."
    : "Beneficios separados del precio para todos.";
}
