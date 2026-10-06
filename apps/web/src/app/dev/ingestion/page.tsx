import {
  coverageReport,
  observationCoverageReport,
  inspectIngestion,
  inspectOperations,
  freshnessHours,
} from "@comprafino/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export const metadata = {
  title: "Developer ingestion inspection",
  robots: { index: false, follow: false },
};

export default async function IngestionPage() {
  await connection();

  if (process.env.NODE_ENV === "production") {
    notFound();
  }

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

  let observations: Awaited<ReturnType<typeof observationCoverageReport>>;
  let coverage: Awaited<ReturnType<typeof coverageReport>>;
  let data: Awaited<ReturnType<typeof inspectIngestion>>;
  let operations: Awaited<ReturnType<typeof inspectOperations>>;

  try {
    [data, operations, coverage, observations] = await Promise.all([
      inspectIngestion(),
      inspectOperations(),
      coverageReport(),
      observationCoverageReport(),
    ]);
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
      <section className="space-y-3">
        <h2 className="text-xl">Durable ordinary-price observation coverage</h2>
        <p>
          {observations.coverageRows} day rows · Started: {observations.earliestDate ?? "none"} ·{" "}
          {observations.averageObservationsPerCoveredListingDay.toFixed(1)} observations per covered
          listing/day
        </p>
        <p>
          Today ({observations.today}, Peru): {observations.observedToday} known listings observed ·{" "}
          {observations.publicObservedToday} / {observations.publicListings} public observed ·{" "}
          {observations.publicMissingToday} missing
        </p>
        {observations.retailers.map((row) => (
          <p key={row.retailer}>
            {row.retailer}: {row.publicObservedToday} / {row.expectedPublic} public observed ·{" "}
            {row.publicMissingToday} missing
          </p>
        ))}
        <p className="text-sm">{observations.note}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">Known listing refresh</h2>
        <p>
          Known: {coverage.knownListings} · Public: {coverage.publicOffers} · Fresh:{" "}
          {coverage.fresh} · Stale: {coverage.stale} · Too stale: {coverage.tooStale}
        </p>
        <p>
          Public without category observation: {coverage.publicWithoutCategoryObservation} · Target
          refreshable: {coverage.publicTargetRefreshable}
        </p>
        <p className="text-sm">{coverage.provenanceNote}</p>
        {coverage.retailers.map((row) => (
          <article key={row.retailer}>
            <h3 className="font-semibold">{row.retailer}</h3>
            <p>
              Known: {row.known} · Public: {row.public} · Category observed:{" "}
              {row.categoryObservedPublic} · Eligible: {row.eligible} · Stale: {row.stale} · Too
              stale: {row.tooStale}
            </p>
            <p>
              Latest targeted attempt: {formatTime(row.lastTargetedAttempt ?? undefined)} · Latest
              outcomes: {JSON.stringify(row.targetedLatestOutcomes)}
            </p>
          </article>
        ))}
        <h3 className="font-semibold">Discovery demand and public coverage</h3>
        <ul>
          {coverage.demand.map((row) => (
            <li key={row.query}>
              {row.query} · {row.requests} requests · {row.currentlyMatchingPublicGroups} matching
              public groups · {row.firstAcquisitionGroups} first-acquisition groups
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4">
        <h2 className="text-xl">Retailer operations</h2>
        <p>
          Healthy ≤ {freshnessHours.healthy} hours · delayed ≤ {freshnessHours.delayed} hours ·
          stale &gt; {freshnessHours.delayed} hours. Times in Peru.
        </p>
        {operations.map((operation) => (
          <article key={operation.retailer}>
            <h3 className="font-semibold">{operation.retailer}</h3>
            <p>
              Freshness: {operation.freshness} · latest attempt:{" "}
              {operation.latestAttemptStatus ?? "none"}
            </p>
            <p>Latest attempt: {formatTime(operation.latestAttempt?.startedAt)}</p>
            <p>
              Latest success: {formatTime(operation.latestSuccess?.startedAt)} · age:{" "}
              {operation.ageHours === null ? "unknown" : `${operation.ageHours.toFixed(1)} hours`}
            </p>
            <p>
              Discovered: {operation.latestAttempt?.listingsFetched ?? "—"} · persisted:{" "}
              {operation.latestAttempt?.listingsPersisted ?? "—"} · new price states:{" "}
              {operation.latestAttempt?.listingsChanged ?? "—"}
            </p>
            {operation.latestFailure ? <p>Latest failure: {operation.latestFailure}</p> : null}
          </article>
        ))}
      </section>
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
                {run.status === "failed"
                  ? " · Ingestion failed; inspect CLI stage and source availability."
                  : ""}
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
                <th>Retailer</th>
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
                  <td>{listing.retailerId}</td>
                  <td>{listing.title}</td>
                  <td>{(listing.currentPriceCents / 100).toFixed(2)}</td>
                  <td>
                    {listing.regularPriceCents === null
                      ? "—"
                      : (listing.regularPriceCents / 100).toFixed(2)}
                  </td>
                  <td>{listing.priceUnit}</td>
                  <td>{availabilityLabel(listing.available)}</td>
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

function formatTime(value: Date | undefined) {
  return value
    ? new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Lima",
      }).format(value)
    : "none";
}

function availabilityLabel(available: boolean | null): string {
  if (available === null) return "Unknown";

  return available ? "Yes" : "No";
}
