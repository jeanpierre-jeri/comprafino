import { Button } from "@comprafino/ui";
import { maximumSearchLength } from "@comprafino/db";

export function SearchForm({ query = "" }: { query?: string }) {
  return (
    <search className="w-full">
      <form action="/search" method="get">
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
            className="h-12 min-w-0 flex-1 rounded-xl border bg-white px-3 sm:px-4 text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <Button type="submit" className="h-12 rounded-xl px-4 sm:px-6">
            Buscar
          </Button>
        </div>
        <p id="search-status" className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Nuestra cobertura sigue creciendo. Compara las opciones disponibles.
        </p>
      </form>
    </search>
  );
}
