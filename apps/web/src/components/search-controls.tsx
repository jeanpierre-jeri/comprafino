"use client";

import { Button, ChevronDown } from "@comprafino/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@comprafino/ui/components/collapsible";
import { ChoiceSelect } from "@comprafino/ui/components/select";
import { useEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFilters, searchFilterQuery } from "@comprafino/core/search-filters";
import type { SearchFilters } from "@comprafino/core/search-filters";
import { searchCategories, searchCategory } from "@comprafino/core";
import { withSearchReturn } from "../lib/search-return";

export function SearchControls({
  query,
  filters,
  units = [],
  comparisonPath,
  resultSummary,
}: {
  query: string;
  filters: SearchFilters;
  units?: string[];
  comparisonPath?: string;
  resultSummary?: string;
}) {
  const router = useRouter();
  const currentParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const toolbar = useRef<HTMLDivElement>(null);
  const changedControl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pending || !changedControl.current) return;

    // Disabling the fieldset during navigation can send focus to the body.
    // Restore the initiating control only when the user has not moved elsewhere.
    if (document.activeElement === document.body) {
      changedControl.current.focus();
    }
    changedControl.current = null;
  }, [pending]);

  function navigate(next: SearchFilters, focusControl: keyof SearchFilters) {
    changedControl.current =
      [...(toolbar.current?.querySelectorAll<HTMLElement>('[role="combobox"]') ?? [])].find(
        (control) =>
          control.getAttribute("aria-label") === controlLabels[focusControl] &&
          control.getClientRects().length > 0,
      ) ?? null;
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

    const destination = `${comparisonPath ?? "/search"}${suffix}`;
    startTransition(() =>
      router.push(
        comparisonPath ? withSearchReturn(destination, currentParams.get("returnTo")) : destination,
        { scroll: false },
      ),
    );
  }

  function change(key: keyof SearchFilters, value: string) {
    navigate(searchFilters({ ...filters, [key]: value }), key);
  }

  const priceControl = (
    <ChoiceSelect
      label="Precios"
      value={filters.priceMode}
      disabled={pending}
      onValueChange={(value) => change("priceMode", value)}
      options={[
        { value: "standard", label: "Sin tarjeta ni membresía" },
        { value: "benefits", label: "Incluir beneficios" },
      ]}
    />
  );

  if (comparisonPath) {
    return (
      <div ref={toolbar} className="filter-surface" aria-busy={pending}>
        <fieldset disabled={pending} className="sm:max-w-sm">
          <legend className="sr-only">Filtros de precios</legend>
          {priceControl}
        </fieldset>
        <output className="mt-2.5 block text-xs leading-relaxed text-muted-foreground">
          {filterStatusMessage(pending, filters.priceMode)}
        </output>
      </div>
    );
  }

  const activeFilters = [
    { key: "category", label: searchCategory(filters.category)?.label, reset: "" },
    {
      key: "retailer",
      label: retailerOptions.find((option) => option.value === filters.retailer)?.label,
      reset: "",
    },
    { key: "unit", label: filters.unit ? `Por ${unitOptionLabel(filters.unit)}` : null, reset: "" },
    {
      key: "priceMode",
      label: filters.priceMode === "benefits" ? "Incluir beneficios" : null,
      reset: "standard",
    },
  ] satisfies { key: keyof SearchFilters; label: string | null | undefined; reset: string }[];
  const selected = activeFilters.filter((filter) => filter.label);
  const activeCountLabel = selected.length === 1 ? "1 activo" : `${selected.length} activos`;
  const secondaryControls = (
    <SecondarySearchFilters filters={filters} units={units} pending={pending} change={change}>
      {priceControl}
    </SecondarySearchFilters>
  );

  return (
    <div ref={toolbar} className="search-toolbar" aria-busy={pending}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <output className="min-w-0 text-sm font-medium">{resultSummary}</output>
        <div className="min-w-40 flex-1 sm:max-w-56">
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
        </div>
      </div>
      <div className="mt-3 hidden lg:block">{secondaryControls}</div>
      <Collapsible className="mt-3 lg:hidden">
        <CollapsibleTrigger render={<Button variant="outline" className="h-11 w-full" />}>
          Filtros{selected.length > 0 ? ` (${activeCountLabel})` : ""}
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-3">{secondaryControls}</div>
        </CollapsibleContent>
      </Collapsible>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Filtros activos">
          {selected.map((filter) => (
            <Button
              key={filter.key}
              variant="secondary"
              className="min-h-11 max-w-full whitespace-normal text-left"
              disabled={pending}
              aria-label={`Quitar filtro: ${filter.label}`}
              onClick={() =>
                navigate(searchFilters({ ...filters, [filter.key]: filter.reset }), "sort")
              }
            >
              {filter.label} <span aria-hidden="true">×</span>
            </Button>
          ))}
          <Button
            variant="link"
            className="min-h-11"
            disabled={pending}
            onClick={() => navigate(searchFilters({ sort: filters.sort }), "sort")}
          >
            Limpiar filtros
          </Button>
        </div>
      )}
      <output className={pending ? "mt-2 block text-sm text-primary" : "sr-only"}>
        {pending ? "Actualizando resultados…" : ""}
      </output>
      {filters.priceMode === "benefits" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {filterStatusMessage(false, filters.priceMode)}
        </p>
      )}
    </div>
  );
}

const retailerOptions = [
  { value: "", label: "Todos" },
  { value: "tottus", label: "Tottus" },
  { value: "plaza-vea", label: "Plaza Vea" },
  { value: "metro", label: "Metro" },
  { value: "makro", label: "Makro" },
];

const controlLabels: Record<keyof SearchFilters, string> = {
  category: "Categoría",
  retailer: "Supermercado",
  unit: "Comparar por",
  priceMode: "Precios",
  sort: "Ordenar",
};

function SecondarySearchFilters({
  filters,
  units,
  pending,
  change,
  children,
}: {
  filters: SearchFilters;
  units: string[];
  pending: boolean;
  change: (key: keyof SearchFilters, value: string) => void;
  children: React.ReactNode;
}) {
  const unitOptions = [...new Set([...units, ...(filters.unit ? [filters.unit] : [])])].map(
    (unit) => ({ value: unit, label: unitOptionLabel(unit) }),
  );

  return (
    <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <legend className="sr-only">Filtros de búsqueda</legend>
      <ChoiceSelect
        label="Categoría"
        value={filters.category ?? ""}
        disabled={pending}
        onValueChange={(value) => change("category", value)}
        options={[
          { value: "", label: "Todas las categorías" },
          ...searchCategories.map((category) => ({ value: category.id, label: category.label })),
        ]}
      />
      <ChoiceSelect
        label="Supermercado"
        value={filters.retailer ?? ""}
        disabled={pending}
        onValueChange={(value) => change("retailer", value)}
        options={retailerOptions}
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
      {children}
    </fieldset>
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
    : "El precio principal no requiere tarjeta ni membresía. Los beneficios se muestran aparte.";
}
