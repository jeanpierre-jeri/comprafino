import { Button } from "@comprafino/ui";
import { maximumSearchLength } from "@comprafino/db";

export function SearchForm({ query = "" }: { query?: string }) {
  return (
    <search className="max-w-xl">
      <form action="/search" method="get">
        <label htmlFor="product-search" className="mb-3 block text-sm font-medium">
          ¿Qué necesitas comprar?
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="product-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={maximumSearchLength}
            placeholder="Leche Gloria, mantequilla, yogurt…"
            aria-describedby="search-status"
            className="h-12 min-w-0 flex-1 rounded-lg border bg-white px-4 text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <Button type="submit" className="h-12 px-7">
            Buscar
          </Button>
        </div>
        <p id="search-status" className="mt-3 text-sm text-muted-foreground">
          Un catálogo inicial de productos comparables. Nuestra cobertura sigue creciendo.
        </p>
      </form>
    </search>
  );
}
