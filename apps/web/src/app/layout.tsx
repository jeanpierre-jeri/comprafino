import { themeInit } from "../components/theme-init";
import { ShoppingListProvider } from "../components/shopping-list/shopping-list-provider";
import { Toaster } from "@comprafino/ui/components/toast";
import type { Metadata } from "next";
import "@comprafino/ui/globals.css";

export const metadata: Metadata = {
  title: "CompraFino · Compra mejor. Paga menos.",
  description: "Compara precios observados de productos de Tottus, Plaza Vea y Metro en Perú.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PE" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ShoppingListProvider>{children}</ShoppingListProvider>
        <Toaster />
      </body>
    </html>
  );
}
