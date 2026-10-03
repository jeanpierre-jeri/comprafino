import Link from "next/link";
import { SearchForm } from "../components/search-form";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex items-center justify-between border-b py-7">
        <Link
          href="/"
          className="text-2xl font-bold tracking-tight"
          aria-label="CompraFino, inicio"
        >
          CompraFino<span className="text-primary">.</span>
        </Link>
        <span className="text-sm text-muted-foreground">Hecho para comprar en Perú</span>
      </header>
      <main className="flex flex-1 flex-col justify-center py-20 sm:py-28">
        <p className="mb-6 text-sm font-semibold uppercase tracking-widest text-primary">
          Tu compra de cada día, mejor pensada
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-7xl">
          Compra mejor.
          <br />
          <span className="text-primary">Paga menos.</span>
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Compara precios observados de un mismo producto y encuentra dónde cuesta menos.
        </p>
        <div className="mt-10 max-w-xl">
          <SearchForm />
        </div>
        <div className="mt-16 border-t pt-6">
          <p className="text-sm text-muted-foreground">Comparamos productos de</p>
          <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-lg font-semibold">
            <li>Tottus</li>
            <li>Plaza Vea</li>
            <li>Metro</li>
          </ul>
        </div>
      </main>
      <footer className="border-t py-6 text-sm text-muted-foreground">
        CompraFino · Más claridad para tus compras.
      </footer>
    </div>
  );
}
