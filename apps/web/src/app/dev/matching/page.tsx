import { inspectMatching } from "@comprafino/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";
export const metadata = {
  title: "Developer matching inspection",
  robots: { index: false, follow: false },
};
export default async function MatchingPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await connection();
  if (!process.env.DATABASE_URL)
    return (
      <main className="p-8">
        <h1>Developer matching inspection</h1>
        <p>Configure DATABASE_URL in apps/web/.env.local and apply migrations.</p>
      </main>
    );
  let data: Awaited<ReturnType<typeof inspectMatching>>;
  try {
    data = await inspectMatching();
  } catch {
    return (
      <main className="p-8">
        <h1>Developer matching inspection</h1>
        <p>
          Inspection failed. Check database configuration, migrations and fresh catalog
          normalization.
        </p>
      </main>
    );
  }
  const groups = new Map<string, typeof data.links>();
  for (const row of data.links)
    groups.set(row.product.id, [...(groups.get(row.product.id) ?? []), row]);
  const rows = new Map(data.rows.map((row) => [row.id, row]));
  return (
    <main className="space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Developer matching inspection</h1>
      <p>
        Read-only. Version {data.version}. Candidate inspection is bounded to 150 listings; saved
        links to 150 associations. Review pairs are recomputed, with no writes.
      </p>
      <pre className="overflow-x-auto">{JSON.stringify(data.metrics, null, 2)}</pre>
      <h2 className="text-xl font-semibold">Saved canonical products</h2>
      {[...groups].map(([id, members]) => (
        <section className="space-y-2 rounded border p-4" key={id}>
          <h3>{members[0]!.product.displayName}</h3>
          <p className="text-sm">{id}</p>
          {members.map(({ link }) => {
            const row = rows.get(link.listingId);
            return (
              <div key={link.listingId}>
                <p>
                  {link.retailerId}:{" "}
                  {row?.title ?? `Listing ${link.listingId} outside inspection sample`}
                </p>
                {row && (
                  <p>
                    {row.attributes.normalizedTitle} | {row.attributes.brandKey} |{" "}
                    {row.attributes.quantity?.value} {row.attributes.quantity?.unit} ×{" "}
                    {row.attributes.packageCount} | total {row.attributes.totalQuantity?.value}{" "}
                    {row.attributes.totalQuantity?.unit} | {row.attributes.pricingBasis} |
                    diagnostics {row.attributes.issues.join(", ") || "none"}
                  </p>
                )}
                <p>
                  {link.method} / auto_match · confidence {link.confidence} · version{" "}
                  {link.matchingVersion}
                </p>
                <p>{link.reasons.join(", ")}</p>
              </div>
            );
          })}
        </section>
      ))}
      <h2 className="text-xl font-semibold">Review candidates</h2>
      {data.pairs
        .filter((p) => p.result.decision === "review")
        .sort((a, b) => b.result.score - a.result.score)
        .slice(0, 20)
        .map((p) => (
          <section className="rounded border p-4" key={`${p.a}-${p.b}`}>
            {[p.a, p.b].map((id) => {
              const row = rows.get(id)!;
              return (
                <p key={id}>
                  {row.retailer}: {row.title} | {row.attributes.brandKey} |{" "}
                  {row.attributes.quantity?.value} {row.attributes.quantity?.unit} ×{" "}
                  {row.attributes.packageCount} | total {row.attributes.totalQuantity?.value} |{" "}
                  {row.attributes.pricingBasis} | {row.attributes.issues.join(", ")}
                </p>
              );
            })}
            <p>
              review · score {p.result.score} · {p.result.reasons.join(", ")}
            </p>
          </section>
        ))}
    </main>
  );
}
