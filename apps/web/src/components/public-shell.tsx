import Link from "next/link";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b py-7">
        <Link
          href="/"
          className="text-2xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="CompraFino, inicio"
        >
          CompraFino<span className="text-primary">.</span>
        </Link>
        <span className="text-sm text-muted-foreground">Hecho para comprar en Perú</span>
      </header>
      <main className="flex-1 py-10 sm:py-14">{children}</main>
      <footer className="border-t py-6 text-sm text-muted-foreground">
        CompraFino · Más claridad para tus compras.
      </footer>
    </div>
  );
}
export function PriceNotice() {
  return (
    <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">
      Precios ordinarios observados en línea, disponibles sin tarjeta o membresía. Los beneficios
      aparecen por separado y requieren la condición indicada. Los precios pueden variar según
      ubicación, canal, disponibilidad y actualizaciones del supermercado.
    </p>
  );
}
export function PublicDataError() {
  return (
    <div className="rounded-xl border p-6">
      <h2 className="text-xl font-semibold">No pudimos cargar los precios.</h2>
      <p className="mt-2 text-muted-foreground">Intenta nuevamente en unos momentos.</p>
      <Link href="/search" className="mt-4 inline-block text-primary underline">
        Volver a buscar
      </Link>
    </div>
  );
}
