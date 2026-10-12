import { ArrowRight, ArrowUpRight } from "@comprafino/ui";
import { NavigationLink } from "../components/navigation-link";
import { SearchForm } from "../components/search-form";
import { PublicShell } from "../components/public-shell";
import { searchCategories } from "@comprafino/core";

export default function Home() {
  return (
    <PublicShell>
      <section className="home-hero" aria-labelledby="home-title">
        <div>
          <p className="eyebrow">Tu compra de cada día, mejor pensada</p>
          <h1
            id="home-title"
            className="mt-5 text-[2.5rem] font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Compra mejor.
            <br />
            <span className="text-primary">Paga menos.</span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed sm:mt-6 sm:text-lg text-muted-foreground">
            Compara productos, tamaños y precios entre supermercados. Elige dónde te conviene
            comprar.
          </p>
          <p className="mt-4 text-xs font-medium sm:mt-6 sm:text-sm text-primary">
            Sin cuenta · Precios observados en línea
          </p>
        </div>
        <div className="search-surface">
          <p className="mb-5 text-xl font-semibold tracking-tight">¿Qué hay en tu lista?</p>
          <SearchForm />
          <div className="mt-4 pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Empieza por una categoría
            </p>
            <ul className="flex flex-wrap gap-2">
              {searchCategories.slice(0, 3).map((category) => (
                <li key={category.id}>
                  <NavigationLink className="search-chip" href={`/search?category=${category.id}`}>
                    {category.label}
                    <ArrowUpRight
                      aria-hidden="true"
                      size={14}
                      className="ml-1 inline-block shrink-0 align-middle"
                    />
                  </NavigationLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="browse-section" aria-labelledby="browse-title">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">Para tu próxima compra</p>
            <h2 id="browse-title" className="mt-2 text-2xl font-semibold tracking-tight">
              Explora por categoría.
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">Elige por dónde empezar.</p>
        </div>
        <ul className="browse-grid">
          {searchCategories.map((category) => (
            <li key={category.id}>
              <NavigationLink href={`/search?category=${category.id}`} className="browse-link">
                <h3 className="text-xl font-semibold tracking-tight">{category.label}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>
                <span className="mt-5 block text-sm font-semibold">
                  Explorar categoría
                  <ArrowRight
                    aria-hidden="true"
                    size={14}
                    className="ml-1 inline-block shrink-0 align-middle"
                  />
                </span>
              </NavigationLink>
            </li>
          ))}
        </ul>
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
          <li className="retailer-badge" data-retailer="makro">
            Makro
          </li>
        </ul>
      </section>
    </PublicShell>
  );
}
