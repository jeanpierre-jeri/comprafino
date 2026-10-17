"use client";

import { cn } from "@comprafino/ui/lib/utils";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Button } from "@comprafino/ui";
import { maximumSearchLength } from "@comprafino/core";
import { searchCategory, searchFilters, searchFilterQuery } from "@comprafino/core";
import type { SearchFilters } from "@comprafino/core";

export function SearchForm({
  compact = false,
  prominent = false,
  query = "",
  filters = searchFilters(),
}: {
  compact?: boolean;
  prominent?: boolean;
  query?: string;
  filters?: SearchFilters;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const category = searchCategory(filters.category);
  const preservedParams = [...new URLSearchParams(searchFilterQuery("", filters))].filter(
    ([key]) => key !== "q",
  );
  useEffect(() => {
    if (!pending) {
      submitting.current = false;
    }
  }, [pending]);

  return (
    <search className="min-w-0 w-full">
      <Form
        action="/search"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();

          if (submitting.current) return;

          const params = new URLSearchParams();
          new FormData(event.currentTarget).forEach((value, key) => {
            if (typeof value === "string") {
              params.set(key, value);
            }
          });
          submitting.current = true;
          startTransition(() => router.push(`/search?${params}`));
        }}
      >
        {preservedParams.map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label
          htmlFor="product-search"
          className={cn("mb-3 block text-sm font-medium", compact && "sr-only")}
        >
          {category ? `Buscar en ${category.label}` : "¿Qué necesitas comprar?"}
        </label>
        <div className={cn("flex gap-2", prominent && "flex-col sm:flex-row")}>
          <input
            key={query}
            id="product-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={maximumSearchLength}
            placeholder="Huevos, arroz, leche Gloria…"
            aria-describedby="search-status"
            className={cn(
              "h-12 min-w-0 flex-1 rounded-xl border bg-surface px-3 sm:px-4 text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              prominent && "h-14 w-full flex-none sm:w-auto sm:flex-1",
            )}
          />
          <Button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={cn("h-12 min-w-28 rounded-xl px-4 sm:px-6", prominent && "sm:h-14")}
          >
            {pending ? "Buscando…" : "Buscar"}
          </Button>
        </div>
      </Form>
      <output
        id="search-status"
        className={cn(
          "mt-3 block text-xs leading-relaxed text-muted-foreground",
          compact && "sr-only",
        )}
      >
        {pending
          ? "Buscando productos…"
          : "Nuestra cobertura sigue creciendo. Compara las opciones disponibles."}
      </output>
    </search>
  );
}
