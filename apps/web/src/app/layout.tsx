import type { Metadata } from "next";
import "@comprafino/ui/globals.css";

export const metadata: Metadata = {
  title: "CompraFino · Compra mejor. Paga menos.",
  description:
    "Estamos construyendo una forma más sencilla de comparar precios de supermercados en Perú.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PE">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
