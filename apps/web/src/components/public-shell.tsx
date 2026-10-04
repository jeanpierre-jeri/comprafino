import Link from "next/link";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-8">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b py-5 sm:py-6">
        <Link
          href="/"
          className="text-2xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="CompraFino, inicio"
        >
          CompraFino<span className="text-primary">.</span>
        </Link>
        <span className="text-xs text-muted-foreground sm:text-sm">Hecho para comprar en Perú</span>
      </header>
      <main id="main-content" className="min-w-0 flex-1 py-7 sm:py-10">
        {children}
      </main>
      <footer className="border-t py-6 text-xs text-muted-foreground">
        CompraFino · Más claridad para tus compras.
      </footer>
    </div>
  );
}
export function PriceNotice() {
  return (
    <p className="price-notice">
      Precios ordinarios observados en línea, sin tarjeta o membresía. Los beneficios requieren la
      condición indicada. Verifica el precio y la disponibilidad en el supermercado: pueden variar
      según ubicación, canal y actualización.
    </p>
  );
}
export function PublicDataError() {
  return (
    <div className="empty-surface">
      <h2 className="text-xl font-semibold">No pudimos cargar los precios.</h2>
      <p className="mt-2 text-muted-foreground">Intenta nuevamente en unos momentos.</p>
      <Link href="/search" className="mt-4 inline-block text-primary underline">
        Volver a buscar
      </Link>
    </div>
  );
}
