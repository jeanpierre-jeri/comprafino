import { inspectCatalog, formatPen, formatUnitPrice } from "@comprafino/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export const metadata = {
  title: "Developer catalog inspection",
  robots: { index: false, follow: false },
};

export default async function CatalogPage() {
  await connection();

  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  if (!process.env.DATABASE_URL) {
    return (
      <main className="p-8">
        <h1>Developer catalog inspection</h1>
        <p>
          Configure DATABASE_URL in apps/web/.env.local and apply migrations to inspect catalog
          attributes.
        </p>
      </main>
    );
  }

  let rows: Awaited<ReturnType<typeof inspectCatalog>>;

  try {
    rows = await inspectCatalog();
  } catch {
    return (
      <main className="p-8">
        <h1>Developer catalog inspection</h1>
        <p>Database inspection failed. Check connection configuration and applied migrations.</p>
      </main>
    );
  }

  return (
    <main className="space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Developer catalog inspection</h1>
      <p>
        Up to 20 listings per retailer. Unknown values stay blank. Stale attributes require another
        normalization run.
      </p>
      {rows.length === 0 ? (
        <p>No listings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {[
                  "Retailer",
                  "Raw title",
                  "Normalized title",
                  "Product family (origin / evidence)",
                  "Source category",
                  "Brand (origin)",
                  "Quantity",
                  "Packages",
                  "Total",
                  "Pricing basis",
                  "Ordinary price",
                  "Unit price / unavailable reason",
                  "Sold by weight",
                  "Source package",
                  "Issues / status",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(
                ({ listing, normalization: a, stale, price, unitPriceCalculation, family }) => (
                  <tr key={listing.id}>
                    <td>{listing.retailerId}</td>
                    <td>{listing.title}</td>
                    <td>{a?.normalizedTitle ?? "—"}</td>
                    <td>
                      {family.family ?? "—"} ({family.origin ?? "unknown"}: {family.evidence})
                    </td>
                    <td>{listing.category ?? "—"}</td>
                    <td>{a?.brand ? `${a.brand} (${a.brandSource})` : "—"}</td>
                    <td>{a?.quantityValue ? `${a.quantityValue} ${a.quantityUnit}` : "—"}</td>
                    <td>{a?.packageCount ?? "—"}</td>
                    <td>
                      {a?.totalQuantityValue
                        ? `${a.totalQuantityValue} ${a.totalQuantityUnit}`
                        : "—"}
                    </td>
                    <td>{a?.pricingBasis ?? "—"}</td>
                    <td>
                      {price ? `${formatPen(price.currentPriceCents)} / ${price.priceUnit}` : "—"}
                    </td>
                    <td>
                      {unitPriceCalculation?.price
                        ? formatUnitPrice(unitPriceCalculation.price)
                        : (unitPriceCalculation?.reason ??
                          "Missing / stale normalization or price")}
                    </td>
                    <td>{soldByWeightLabel(a?.soldByWeight)}</td>
                    <td>{listing.packageText ?? "—"}</td>
                    <td>{normalizationLabel(a, stale)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function soldByWeightLabel(soldByWeight: boolean | undefined): string {
  if (soldByWeight === undefined) return "—";

  return soldByWeight ? "Yes" : "No";
}

function normalizationLabel(
  attributes: { normalizationVersion: number; issues: string[] } | null | undefined,
  stale: boolean,
): string {
  if (!attributes) return "Not normalized";

  if (stale) return "Stale";

  return `v${attributes.normalizationVersion} ${attributes.issues.join(", ")}`;
}
