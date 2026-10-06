"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Button } from "@comprafino/ui";
import { maximumSearchLength } from "@comprafino/core";

export function SearchForm({ query = "" }: { query?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  useEffect(() => {
    if (!pending) {
      submitting.current = false;
    }
  }, [pending]);

  return (
    <search className="w-full">
      <Form
        action="/search"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();

          if (submitting.current) return;

          const value = new FormData(event.currentTarget).get("q");
          const params = new URLSearchParams({ q: typeof value === "string" ? value : "" });
          submitting.current = true;
          startTransition(() => router.push(`/search?${params}`));
        }}
      >
        <label htmlFor="product-search" className="mb-3 block text-sm font-medium">
          ¿Qué necesitas comprar?
        </label>
        <div className="flex gap-2">
          <input
            id="product-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={maximumSearchLength}
            placeholder="Huevos, arroz, leche Gloria…"
            aria-describedby="search-status"
            className="h-12 min-w-0 flex-1 rounded-xl border bg-surface px-3 sm:px-4 text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <Button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="h-12 min-w-28 rounded-xl px-4 sm:px-6"
          >
            {pending ? "Buscando…" : "Buscar"}
          </Button>
        </div>
      </Form>
      <output
        id="search-status"
        className="mt-3 block text-xs leading-relaxed text-muted-foreground"
      >
        {pending
          ? "Buscando productos…"
          : "Nuestra cobertura sigue creciendo. Compara las opciones disponibles."}
      </output>
    </search>
  );
}
