import Link from "next/link";
import { validatedSearchReturn } from "../lib/search-return";

export function DetailReturnLink({ returnTo }: { returnTo: unknown }) {
  const destination = validatedSearchReturn(returnTo);

  return (
    <Link
      href={destination ?? "/search"}
      scroll={!destination?.includes("#scroll=")}
      className="text-sm font-medium text-primary underline underline-offset-4"
    >
      {destination ? "Volver a resultados" : "Buscar otro producto"}
    </Link>
  );
}
