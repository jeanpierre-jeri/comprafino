"use client";

import Link from "next/link";
import { ArrowUpRight, buttonVariants } from "@comprafino/ui";
import type { ShoppingCreationSeed } from "@comprafino/core";
import { AddShoppingItem } from "./shopping-list/shopping-item-editor";

export function PurchaseActions({
  comparisonHref,
  seed,
  stores,
}: {
  comparisonHref?: string;
  seed: ShoppingCreationSeed;
  stores: { name: string; url: string }[];
}) {
  return (
    <fieldset className="mt-5 flex min-w-0 flex-col gap-3">
      <legend className="sr-only">Acciones de compra</legend>
      <div className="flex flex-wrap items-center gap-3">
        {comparisonHref && (
          <Link
            href={comparisonHref}
            className={buttonVariants({ className: "min-h-11 h-auto whitespace-normal py-3" })}
          >
            Comparar entre supermercados
          </Link>
        )}
        <AddShoppingItem
          inline
          seed={seed}
          primary={!comparisonHref}
          buttonLabel="Agregar a mi lista"
        />
      </div>
      <div className="flex flex-col items-start gap-2">
        {stores.map((store) => (
          <a
            key={store.url}
            className={buttonVariants({
              variant: "link",
              className:
                "min-h-11 h-auto max-w-full flex-wrap justify-start whitespace-normal text-left",
            })}
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver producto en {store.name}
            <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">(nueva pestaña)</span>
          </a>
        ))}
      </div>
    </fieldset>
  );
}
