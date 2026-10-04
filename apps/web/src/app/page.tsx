import Link from "next/link";
import { SearchForm } from "../components/search-form";
import { PublicShell } from "../components/public-shell";

const examples = ["Huevos", "Arroz", "Aceite", "Leche"];

export default function Home() {
  return (
    <PublicShell>
      <section className="home-hero" aria-labelledby="home-title">
        <div>
          <p className="eyebrow">Tu compra de cada día, mejor pensada</p>
          <h1
            id="home-title"
            className="mt-5 text-[2.5rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          >
            Compra mejor.
            <br />
            <span className="text-primary">Paga menos.</span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed sm:mt-6 sm:text-lg text-muted-foreground">
            Lo que necesitas, al precio que te conviene. Compara productos y tamaños entre
            supermercados, en un solo lugar.
          </p>
          <p className="mt-4 text-xs font-medium sm:mt-6 sm:text-sm text-primary">
            Sin cuenta · Precios observados en línea
          </p>
        </div>
        <div className="search-surface">
          <p className="mb-5 text-xl font-semibold tracking-tight">Empieza con algo de tu lista.</p>
          <SearchForm />
          <div className="mt-6 border-t pt-5">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              Prueba con lo de cada día
            </p>
            <ul className="flex flex-wrap gap-2">
              {examples.map((name) => (
                <li key={name}>
                  <Link
                    prefetch={false}
                    className="search-chip"
                    href={`/search?q=${encodeURIComponent(name.toLowerCase())}`}
                  >
                    {name}
                    <span aria-hidden="true"> ↗</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="mt-10 sm:mt-14" aria-labelledby="help-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <h2 id="help-title" className="text-2xl font-semibold tracking-tight">
            Más claridad, antes de comprar.
          </h2>
          <p className="text-sm text-muted-foreground">Una búsqueda. Una decisión más fácil.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            [
              "01",
              "Encuentra tus básicos",
              "Busca un producto, una marca o un tamaño para explorar las opciones disponibles.",
            ],
            [
              "02",
              "Compara con contexto",
              "Mira el precio del paquete y por unidad. Los beneficios muestran sus condiciones.",
            ],
            [
              "03",
              "Elige dónde comprar",
              "Compara el mismo producto entre tiendas y consulta la oferta en el supermercado.",
            ],
          ].map(([step, title, copy]) => (
            <div key={step} className="rounded-2xl border bg-white/60 p-5 sm:p-6">
              <span className="text-sm font-semibold text-primary">{step}</span>
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="retailer-strip" aria-label="Supermercados incluidos">
        <div>
          <p className="font-medium">Tus supermercados, más cerca.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Catálogo en crecimiento. Precios según ubicación y canal.
          </p>
        </div>
        <ul className="flex flex-wrap gap-3">
          <li className="retailer-badge" data-retailer="tottus">
            Tottus
          </li>
          <li className="retailer-badge" data-retailer="plaza-vea">
            Plaza Vea
          </li>
          <li className="retailer-badge" data-retailer="metro">
            Metro
          </li>
        </ul>
      </section>
    </PublicShell>
  );
}
