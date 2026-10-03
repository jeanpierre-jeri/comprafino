import Link from "next/link";
import { PublicShell } from "../../../components/public-shell";

export default function ProductNotFound() {
  return (
    <PublicShell>
      <h1 className="text-3xl font-semibold">No encontramos ese producto.</h1>
      <p className="mt-4 text-muted-foreground">
        Todavía no tenemos una comparación disponible para este producto.
      </p>
      <Link href="/search" className="mt-6 inline-block text-primary underline">
        Buscar productos
      </Link>
    </PublicShell>
  );
}
