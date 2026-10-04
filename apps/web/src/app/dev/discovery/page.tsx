import { inspectDiscovery } from "@comprafino/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export const metadata = {
  title: "Developer discovery inspection",
  robots: { index: false, follow: false },
};
export default async function DiscoveryPage() {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  let data: Awaited<ReturnType<typeof inspectDiscovery>>;
  try {
    data = await inspectDiscovery();
  } catch {
    return (
      <main className="p-8">
        <h1>Developer discovery inspection</h1>
        <p>Configure DATABASE_URL and apply migrations. Database inspection is unavailable.</p>
      </main>
    );
  }
  const now = data.stats.inspectedAt.getTime();
  const date = (value: Date | null) => value?.toISOString() ?? "—";
  return (
    <main className="space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Developer discovery inspection</h1>
      <p>
        Top 100 by request count, then first requested. {data.stats.total} queries;{" "}
        {data.stats.processedToday}/30 attempts today (UTC); {data.stats.cooldown} in cooldown.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              {[
                "Normalized query",
                "Original sample",
                "Requests",
                "First requested",
                "Last requested",
                "Last attempted",
                "Last completed",
                "Status",
                "Listings",
                "Next eligibility",
                "Latest error",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.queries.map((row) => (
              <tr key={row.id}>
                <td>{row.normalizedQuery}</td>
                <td>{row.originalQuery}</td>
                <td>{row.requestCount}</td>
                <td>{date(row.firstRequestedAt)}</td>
                <td>{date(row.lastRequestedAt)}</td>
                <td>{date(row.lastAttemptedAt)}</td>
                <td>{date(row.lastCompletedAt)}</td>
                <td>{row.status}</td>
                <td>{row.latestResultCount}</td>
                <td>
                  {row.nextEligibleAt.getTime() > now ? "Cooldown until " : "Eligible from "}
                  {date(row.nextEligibleAt)}
                  {row.status === "completed" &&
                  row.lastAttemptedAt &&
                  row.lastRequestedAt < row.lastAttemptedAt
                    ? " (needs new demand)"
                    : ""}
                </td>
                <td>{row.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
