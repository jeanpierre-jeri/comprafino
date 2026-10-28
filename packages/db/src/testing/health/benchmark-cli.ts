import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspectCatalogHealth } from "../../catalog-health.ts";
import { reportOutputPath, writeReport } from "../../report-output.ts";
import { closeLocalTestConnections } from "../test-query-client.ts";
import { healthFixture, healthFixtureNow } from "./fixture.ts";
import { legacyCatalogHealth } from "./legacy-catalog-health.ts";
import { healthObserver } from "./observer.ts";

const options = process.argv.slice(2).filter((argument) => argument !== "--");
if (
  options.some(
    (argument) => !/^(--baseline|--output=.+|--samples=\d+|--sizes=\d+(,\d+)*)$/u.test(argument),
  )
) {
  throw new Error("Use --baseline, --output=path, --samples=2..100, --sizes=1000,10000,50000");
}
if (new Set(options.map((argument) => argument.split("=")[0])).size !== options.length) {
  throw new Error("Duplicate benchmark option");
}
const baseline = options.includes("--baseline");
const samples = Number(
  options.find((argument) => argument.startsWith("--samples="))?.slice(10) ?? 20,
);
const sizes = (
  options.find((argument) => argument.startsWith("--sizes="))?.slice(8) ?? "1000,10000,50000"
)
  .split(",")
  .map(Number);
if (
  samples < 2 ||
  samples > 100 ||
  sizes.some((size) => size < 1 || size > 50_000) ||
  new Set(sizes).size !== sizes.length
) {
  throw new Error("Invalid health benchmark bounds");
}
const output = reportOutputPath(options.filter((argument) => argument.startsWith("--output=")));
const fixture = healthFixture(process.env);
const measurements = [];
let cleanedUp = false;

async function measure(reader: typeof legacyCatalogHealth) {
  const observer = healthObserver(fixture.scoped);
  const started = performance.now();
  const report = await reader(observer.db, healthFixtureNow);
  return { report, elapsedMs: performance.now() - started, ...observer.metrics };
}

function summary(measured: Awaited<ReturnType<typeof measure>>[]) {
  const sorted = measured.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const first = measured[0]!;
  for (const sample of measured) {
    for (const key of [
      "calls",
      "statements",
      "rows",
      "candidateRows",
      "pages",
      "logicalJsonBytes",
      "pageJsonBytes",
    ] as const) {
      assert.equal(sample[key], first[key], `Unstable ${key}`);
    }
  }
  return {
    rows: first.rows,
    candidateRows: first.candidateRows,
    pages: first.pages,
    calls: first.calls,
    statements: first.statements,
    logicalJsonBytes: first.logicalJsonBytes,
    pageJsonBytes: first.pageJsonBytes,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: samples >= 20 ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    samples: measured.map(({ report: _report, ...sample }) => sample),
  };
}

try {
  await fixture.setup();
  for (const size of sizes) {
    await fixture.seed(size);
    const digest = await fixture.scoped.query(`select
      (select md5(string_agg(to_jsonb(l)::text,'' order by id)) from retailer_listings l) as listings,
      (select md5(string_agg(to_jsonb(n)::text,'' order by listing_id)) from listing_normalizations n) as normalizations,
      (select md5(string_agg(to_jsonb(h)::text,'' order by listing_id)) from price_history h) as prices,
      (select md5(string_agg(to_jsonb(r)::text,'' order by id)) from ingestion_runs r) as runs`);
    const current = [];
    const previous = [];
    // Warm each path once; alternate measured order to avoid always warming one reader first.
    await measure(inspectCatalogHealth);
    if (!baseline) await measure(legacyCatalogHealth);
    for (let index = 0; index < samples; index++) {
      if (baseline) {
        current.push(await measure(inspectCatalogHealth));
      } else {
        const readers =
          index % 2 === 0
            ? [legacyCatalogHealth, inspectCatalogHealth]
            : [inspectCatalogHealth, legacyCatalogHealth];
        const first = await measure(readers[0]!);
        const second = await measure(readers[1]!);
        assert.deepEqual(first.report, second.report);
        previous.push(index % 2 === 0 ? first : second);
        current.push(index % 2 === 0 ? second : first);
      }
      if ((index + 1) % 5 === 0) {
        console.log(JSON.stringify({ size, completedPairs: index + 1, samples, baseline }));
      }
    }
    const after = summary(current);
    const before = baseline ? null : summary(previous);
    const measurement = {
      size,
      digest,
      report: current[0]!.report,
      before,
      after,
      equivalent: baseline ? null : true,
      reductionPercent: before
        ? 100 * (1 - after.logicalJsonBytes / before.logicalJsonBytes)
        : null,
    };
    measurements.push(measurement);
    console.log(
      JSON.stringify({
        size,
        bytes: after.logicalJsonBytes,
        calls: after.calls,
        statements: after.statements,
        p50Ms: after.p50Ms,
        reductionPercent: measurement.reductionPercent,
      }),
    );
  }
} finally {
  try {
    await fixture.dispose();
    cleanedUp = true;
  } finally {
    await closeLocalTestConnections();
  }
}

writeReport(output, {
  baseline,
  samples,
  now: healthFixtureNow.toISOString(),
  node: process.version,
  cleanedUp,
  sourceHashes: Object.fromEntries(
    [
      "../../catalog-health.ts",
      "./legacy-catalog-health.ts",
      "./fixture.ts",
      "./observer.ts",
      "./benchmark-cli.ts",
    ].map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(new URL(path, import.meta.url)))
        .digest("hex"),
    ]),
  ),
  units: "UTF-8 JSON.stringify(result.rows), decoded local results; not Neon wire/billed bytes",
  calls:
    "Application client calls and SQL statements; excludes fixture setup, BEGIN/COMMIT and test search_path statements",
  timing:
    "Whole instrumented reader over local TCP, warm runs; includes validation and byte counting",
  measurements,
});
console.log(JSON.stringify({ output, cleanedUp }));
