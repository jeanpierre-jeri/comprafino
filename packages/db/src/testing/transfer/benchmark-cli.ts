import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { reportOutputPath, writeReport } from "../../report-output.ts";
import { closeLocalTestConnections } from "../test-query-client.ts";
import { transferFixture, transferNow } from "./fixture.ts";
import { transferObserver } from "./observer.ts";
import { functionalResult, transferCases } from "./workloads.ts";
import type { TransferCase } from "./workloads.ts";

const options = process.argv.slice(2).filter((argument) => argument !== "--");
if (
  options.some(
    (arg) =>
      !/^(--baseline|--output=.+|--sizes=\d+(,\d+)*|--samples=\d+|--cases=[a-z0-9,-]+)$/u.test(arg),
  ) ||
  new Set(options.map((arg) => arg.split("=")[0])).size !== options.length
) {
  throw new Error(
    "Use --baseline, --output=path, --sizes=1000,10000,50000, --samples=5, --cases=case-id",
  );
}
const baseline = options.includes("--baseline");
const samples = Number(options.find((arg) => arg.startsWith("--samples="))?.slice(10) ?? 5);
const sizes = (options.find((arg) => arg.startsWith("--sizes="))?.slice(8) ?? "1000,10000,50000")
  .split(",")
  .map(Number);
const requested = options
  .find((arg) => arg.startsWith("--cases="))
  ?.slice(8)
  .split(",");
const cases = transferCases().filter((test) => !requested || requested.includes(test.id));
if (
  samples < 2 ||
  samples > 30 ||
  !cases.length ||
  requested?.some((id) => !cases.some((test) => test.id === id)) ||
  sizes.some((size) => size < 320 || size > 50_000) ||
  new Set(sizes).size !== sizes.length
) {
  throw new Error("Invalid transfer benchmark bounds");
}
const output = reportOutputPath(options.filter((arg) => arg.startsWith("--output=")));
const fixture = transferFixture(process.env);
const measurements = [];
const digests = [];
let cleanedUp = false;

async function measure(test: TransferCase, legacy: boolean) {
  const observer = transferObserver(fixture.scoped);
  const started = performance.now();
  const result = await test.run(observer.db, legacy);
  const elapsedMs = performance.now() - started;
  const functional = functionalResult(result);
  // Serialization is deliberately outside elapsedMs except for SQL byte counting.
  return {
    functional,
    resultDigest: createHash("sha256")
      .update(
        JSON.stringify(functional, (_key, value: unknown) =>
          typeof value === "bigint" ? { bigint: value.toString() } : value,
        ),
      )
      .digest("hex"),
    elapsedMs,
    ...observer.metrics,
  };
}

function summary(measured: Awaited<ReturnType<typeof measure>>[]) {
  const first = measured[0]!;
  const {
    functional: _functional,
    resultDigest: _resultDigest,
    elapsedMs: _elapsedMs,
    queryMs: _queryMs,
    ...counts
  } = first;
  for (const sample of measured) {
    for (const key of [
      "calls",
      "statements",
      "rows",
      "candidates",
      "historyRows",
      "weekdayRows",
      "logicalJsonBytes",
      "candidateBytes",
      "historyBytes",
      "weekdayBytes",
    ] as const) {
      assert.equal(sample[key], first[key], `Unstable ${key}`);
    }
    assert.equal(sample.resultDigest, first.resultDigest, "Unstable functional response");
  }
  const sorted = measured.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  return {
    ...counts,
    resultDigest: first.resultDigest,
    p50Ms: sorted[Math.ceil(samples / 2) - 1],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    p95Ms: samples >= 20 ? sorted[Math.ceil(samples * 0.95) - 1] : null,
    samples: measured.map(({ functional: _value, ...sample }) => sample),
  };
}

try {
  await fixture.setup();
  for (const size of sizes) {
    await fixture.seed(size);
    digests.push({ size, tables: await fixture.digest() });
    for (const test of cases) {
      await measure(test, false);
      if (!baseline) await measure(test, true);
      const previous = [];
      const current = [];
      for (let index = 0; index < samples; index++) {
        if (baseline) {
          current.push(await measure(test, false));
        } else {
          const first = await measure(test, index % 2 === 0);
          const second = await measure(test, index % 2 !== 0);
          assert.deepEqual(first.functional, second.functional);
          previous.push(index % 2 === 0 ? first : second);
          current.push(index % 2 === 0 ? second : first);
        }
      }
      const before = baseline ? null : summary(previous);
      const after = summary(current);
      const result = {
        size,
        id: test.id,
        kind: test.kind,
        before,
        after,
        reductionPercent:
          before && before.logicalJsonBytes
            ? 100 * (1 - after.logicalJsonBytes / before.logicalJsonBytes)
            : 0,
        equivalent: baseline ? null : true,
      };
      measurements.push(result);
      console.log(
        JSON.stringify({
          size,
          id: test.id,
          bytes: after.logicalJsonBytes,
          candidates: after.candidates,
          p50Ms: after.p50Ms,
          reductionPercent: result.reductionPercent,
        }),
      );
    }
  }
} finally {
  try {
    await fixture.dispose();
    cleanedUp = true;
  } finally {
    await closeLocalTestConnections();
  }
}

const paths = [
  "../../shopping-list.ts",
  "../../generic-offers.ts",
  "../../public-products.ts",
  "../../shopping-price-history.ts",
  "../../weekday-recommendation.ts",
  "../../shopping-snapshot-transport.ts",
  "./legacy-shopping-list.ts",
  "./legacy-shopping-price-history.ts",
  "./legacy-weekday-recommendation.ts",
  "./fixture.ts",
  "./observer.ts",
  "./workloads.ts",
  "./benchmark-cli.ts",
];
writeReport(output, {
  baseline,
  samples,
  now: transferNow.toISOString(),
  node: process.version,
  cleanedUp,
  sourceHashes: Object.fromEntries(
    paths.map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(new URL(path, import.meta.url)))
        .digest("hex"),
    ]),
  ),
  units: "UTF-8 JSON.stringify(decoded result.rows); not PostgreSQL wire or Neon billed transfer",
  timing:
    "Whole local reader including byte-count instrumentation; excludes fixture work and result-digest serialization",
  calls: "Application batches/SELECT statements; excludes local BEGIN/COMMIT/search_path",
  equivalence:
    "Complete functional results, excluding only nondeterministic timings; no output truncation",
  digests,
  measurements,
});
console.log(JSON.stringify({ output, cleanedUp }));
