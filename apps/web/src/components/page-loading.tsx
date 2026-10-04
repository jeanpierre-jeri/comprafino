import { Skeleton } from "@comprafino/ui/components/skeleton";
import { PublicShell } from "./public-shell";

function ToolbarSkeleton({ comparison = false }: { comparison?: boolean }) {
  return (
    <div className="filter-surface" aria-hidden="true">
      <div
        className={`grid gap-3 ${comparison ? "sm:max-w-sm" : "min-[380px]:grid-cols-2 lg:grid-cols-4"}`}
      >
        {Array.from({ length: comparison ? 1 : 4 }, (_, i) => (
          <div key={i}>
            <Skeleton className="mb-2 h-3 w-20 bg-border" />
            <Skeleton className="h-11 w-full bg-surface" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-3 h-3 w-3/4 bg-border" />
    </div>
  );
}
export function SearchPageLoading() {
  return (
    <PublicShell>
      <output className="mb-4 block text-sm font-medium text-primary">Buscando productos…</output>
      <div aria-busy="true" aria-label="Cargando resultados de búsqueda">
        <div className="search-heading" aria-hidden="true">
          <div>
            <p className="eyebrow">Precios con contexto</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Encuentra y compara
            </h1>
            <Skeleton className="mt-3 h-4 w-3/4" />
          </div>
          <div>
            <Skeleton className="mb-3 h-4 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-12 min-w-0 flex-1" />
              <Skeleton className="h-12 w-28" />
            </div>
            <Skeleton className="mt-3 h-3 w-3/4" />
          </div>
        </div>
        <ToolbarSkeleton />
        <Skeleton className="my-6 h-6 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="product-card" key={i}>
              <div className="product-summary">
                <Skeleton className="aspect-square w-full" />
                <div>
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="mt-2 h-5 w-3/4" />
                  <Skeleton className="mt-3 h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="mt-4 h-10 w-28" />
              <Skeleton className="mt-3 h-4 w-2/3" />
              <div className="mt-5 flex justify-between gap-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="mt-4 h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
export function ProductPageLoading() {
  return (
    <PublicShell>
      <output className="mb-4 block text-sm font-medium text-primary">Abriendo comparación…</output>
      <div aria-busy="true" aria-label="Cargando comparación de producto">
        <Skeleton className="h-4 w-40" />
        <div className="detail-hero" aria-hidden="true">
          <Skeleton className="h-48 w-full sm:h-64" />
          <div>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="mt-4 h-4 w-20" />
            <Skeleton className="mt-3 h-10 w-full" />
            <Skeleton className="mt-2 h-10 w-3/4" />
            <Skeleton className="mt-4 h-4 w-1/2" />
            <Skeleton className="mt-6 h-14 w-36" />
          </div>
        </div>
        <ToolbarSkeleton comparison />
        <Skeleton className="my-6 h-7 w-3/4 sm:w-80" />
        <div className="space-y-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="comparison-row" key={i}>
              <div>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="mt-3 h-3 w-48" />
              </div>
              <div>
                <Skeleton className="h-9 w-28" />
                <Skeleton className="mt-3 h-3 w-32" />
                <Skeleton className="mt-4 h-10 w-44" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl bg-surface p-4 sm:p-6" aria-hidden="true">
          <Skeleton className="h-7 w-3/4 sm:w-80" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-6 h-64 w-full" />
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
