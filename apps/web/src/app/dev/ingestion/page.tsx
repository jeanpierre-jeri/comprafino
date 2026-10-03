import { inspectIngestion } from "@comprafino/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";
export const metadata = {
  title: "Developer ingestion inspection",
  robots: { index: false, follow: false },
};
export default async function IngestionPage() {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  if (!process.env.DATABASE_URL) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1>Developer ingestion inspection</h1>
        <p>
          Configure DATABASE_URL in apps/web/.env.local and apply migrations to inspect ingestion
          results.
        </p>
      </main>
    );
  }
  let data: Awaited<ReturnType<typeof inspectIngestion>>;
  try {
    data = await inspectIngestion();
  } catch {
    return (
      <main className="p-8">
        <h1>Developer ingestion inspection</h1>
        <p>Database inspection failed. Check connection configuration and applied migrations.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Developer ingestion inspection</h1>
      <section>
        <h2 className="text-xl">Latest ingestion runs</h2>
        {data.runs.length === 0 ? (
          <p>No ingestion runs yet.</p>
        ) : (
          <ul>
            {data.runs.map((run) => (
              <li key={run.id}>
                {run.retailerId} · {run.status} · {run.listingsFetched} discovered ·{" "}
                {run.listingsPersisted} persisted · {run.listingsChanged} new price states ·{" "}
                {run.startedAt.toISOString()}
                {run.error ? ` · ${run.error}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-xl">Recent listings</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Title</th>
                <th>Current PEN</th>
                <th>Regular PEN</th>
                <th>Unit</th>
                <th>Available</th>
                <th>Last seen (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {data.listings.map((listing) => (
                <tr key={listing.id}>
                  <td>{listing.title}</td>
                  <td>{(listing.currentPriceCents / 100).toFixed(2)}</td>
                  <td>
                    {listing.regularPriceCents === null
                      ? "—"
                      : (listing.regularPriceCents / 100).toFixed(2)}
                  </td>
                  <td>{listing.priceUnit}</td>
                  <td>
                    {listing.available === null ? "Unknown" : listing.available ? "Yes" : "No"}
                  </td>
                  <td>{listing.lastSeenAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
