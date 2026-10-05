import type { Metadata } from "next";
import { ShoppingListView } from "../../components/shopping-list";
import { PriceNotice, PublicShell } from "../../components/public-shell";
export const metadata: Metadata = { title: "Mi lista de compras | CompraFino" };
export default function ListPage() {
  return (
    <PublicShell>
      <ShoppingListView />
      <PriceNotice />
    </PublicShell>
  );
}
