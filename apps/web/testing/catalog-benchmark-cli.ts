import {
  makeCatalogList,
  catalogSearchCases,
  catalogBasketCases,
} from "./catalog-benchmark-workloads.ts";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cpus, totalmem } from "node:os";
import { searchFilters, shoppingListEvaluationSchema } from "@comprafino/core";
import type { PriceMode } from "@comprafino/core";
import { searchGroupedPublicProducts, evaluateCurrentShoppingList } from "@comprafino/db";
import { ownedTestDatabase } from "../../../packages/db/src/testing/database.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import {
  seedCatalogBenchmark,
  growCatalogBenchmark,
} from "../../../packages/db/src/testing/catalog-benchmark-fixtures.ts";
import { catalogBenchmarkDiagnostics } from "../../../packages/db/src/testing/catalog-benchmark-diagnostics.ts";
import {
  benchmarkFailure,
  catalogBenchmarkObserver,
} from "../../../packages/db/src/testing/catalog-benchmark-observer.ts";
import { reportOutputPath, writeReport } from "../../../packages/db/src/report-output.ts";
import { shoppingListPost } from "../src/server/shopping-list-handler.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (
  args.some(
    (arg) =>
      arg !== "--diagnostics" &&
      !/^--(output|sizes|samples|stability-samples|warmups|cases|concurrency)=/u.test(arg),
  )
) {
  throw new Error(
    "Use --output=path --sizes=2000,10000,50000 --samples=20 --stability-samples=100 --warmups=2 --cases=id,id --concurrency=1|4|both [--diagnostics]",
  );
}
const selectedCases = option("cases")?.split(",");
const concurrencyMode = option("concurrency") ?? "both";
if (!["1", "4", "both"].includes(concurrencyMode)) {
  throw new Error("Invalid concurrency selection");
}
const sizes = (option("sizes") ?? "2000,10000,50000").split(",").map(Number);
const samples = Number(option("samples") ?? 20);
const stabilitySamples = Number(option("stability-samples") ?? 0);
const warmups = Number(option("warmups") ?? 2);
if (
  sizes.some(
    (size, i) => ![2000, 10000, 50000].includes(size) || (i > 0 && size <= sizes[i - 1]!),
  ) ||
  !Number.isInteger(samples) ||
  samples < 2 ||
  samples > 100 ||
  !Number.isInteger(stabilitySamples) ||
  (stabilitySamples !== 0 &&
    (stabilitySamples < 20 ||
      stabilitySamples > 100 ||
      stabilitySamples % 4 !== 0 ||
      !sizes.includes(50_000))) ||
  !Number.isInteger(warmups) ||
  warmups < 1 ||
  warmups > 10
) {
  throw new Error("Invalid benchmark sizes or sample counts");
}
const stamp = new Date().toISOString().replaceAll(":", "-");
const outputPath = reportOutputPath([
  `--output=${option("output") ?? `.artifacts/catalog-${stamp}/results.json`}`,
]);
const directory = dirname(outputPath);
mkdirSync(directory, { recursive: true });
const progressPath = `${outputPath}.progress.jsonl`;
writeFileSync(progressPath, "", { flag: "wx" });
const harness = ownedTestDatabase();
const observer = catalogBenchmarkObserver(harness);
const now = new Date();
const POST = shoppingListPost(
  () => observer.db,
  (db, list, mode) => evaluateCurrentShoppingList(db, list, mode, now),
);

type Case = {
  id: string;
  parameters: Record<string, unknown>;
  run: () => Promise<{ status: number; [key: string]: unknown }>;
  plan?: boolean;
};
type Sample = {
  status: number;
  dbErrors: ReturnType<typeof benchmarkFailure>[];
  totalMs: number;
  dbWaitSumMs: number;
  heapUsedBytes: number;
  rssBytes: number;
};

function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    min: ordered[0] ?? null,
    p50: ordered[Math.ceil(ordered.length * 0.5) - 1] ?? null,
    p95: ordered.length >= 20 ? ordered[Math.ceil(ordered.length * 0.95) - 1] : null,
    max: ordered.at(-1) ?? null,
  };
}

function cases(exactIds: string[]): Case[] {
  const result: Case[] = [];
  const search = (
    id: string,
    query: string,
    params: Record<string, unknown> = {},
    page = 1,
    plan = false,
  ) => {
    const filters = searchFilters(params);
    result.push({
      id,
      parameters: { kind: "search-reader", query, filters, page, includeComparisons: false },
      plan,
      run: async () => {
        const response = await searchGroupedPublicProducts(
          observer.db,
          query,
          filters.sort,
          now,
          filters,
          page,
        );
        if (response.products.length > 30) {
          throw new Error("Public search pagination invariant failed");
        }
        return {
          status: 200,
          productsReturned: response.products.length,
          totalProducts: response.totalProducts,
          totalOffers: response.totalOffers,
          hasMore: response.hasMore,
          units: response.availableUnits,
        };
      },
    });
  };
  for (const scenario of catalogSearchCases()) {
    search(scenario.id, scenario.query, scenario.params, scenario.page, scenario.plan);
  }
  const basket = (
    count: number,
    mode: PriceMode,
    composition: "mixed" | "strict" | "generic" = "mixed",
  ) => {
    const list = makeCatalogList(now, exactIds, count, composition);
    const body = JSON.stringify(list);
    result.push({
      id: `basket-${composition}-${count}-${mode}`,
      parameters: {
        kind: "local-POST-handler",
        count,
        mode,
        composition,
        intents: list.items.map((i) => i.intent),
      },
      plan: mode === "standard",
      run: async () => {
        const response = await POST(
          new Request(`http://localhost/api/list/evaluate?priceMode=${mode}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          }),
        );
        if (!response.ok) {
          return { status: response.status };
        }
        const evaluation = shoppingListEvaluationSchema.parse(await response.json());
        if (evaluation.evaluations.length !== count) {
          throw new Error("Basket result lost needs");
        }
        return {
          status: response.status,
          evaluations: evaluation.evaluations.length,
          baskets: evaluation.baskets.map((b) => ({
            maxRetailers: b.maxRetailers,
            totalCostCents: b.totalCostCents,
          })),
          timings: evaluation.timings,
        };
      },
    });
  };
  for (const scenario of catalogBasketCases()) {
    basket(scenario.count, scenario.mode, scenario.composition);
  }
  return result;
}

async function measure(test: Case, size: number, concurrency = 1, sampleCount = samples) {
  const startedAt = new Date().toISOString();
  const operation = async () => {
    try {
      return await test.run();
    } catch (error) {
      return { status: 500, error: benchmarkFailure(error) };
    }
  };
  globalThis.gc?.();
  const memoryBefore = process.memoryUsage();
  let peakRssBytes = memoryBefore.rss;
  let peakHeapUsedBytes = memoryBefore.heapUsed;
  const captureMemory = () => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    return memory;
  };
  const timer = setInterval(captureMemory, 10);
  const measured: Sample[] = [];
  try {
    // Byte serialization and SQL capture are confined to an excluded warmup.
    const probe = await observer.observe(operation, true);
    const warmupFailures = [];
    if (probe.result.status !== 200) {
      warmupFailures.push({ status: probe.result.status, errors: probe.metrics.dbErrors });
    }
    for (let run = 1; run < warmups; run++) {
      const warm = await Promise.all(
        Array.from({ length: concurrency }, () => observer.observe(operation)),
      );
      warmupFailures.push(
        ...warm
          .filter((w) => w.result.status !== 200)
          .map((w) => ({ status: w.result.status, errors: w.metrics.dbErrors })),
      );
    }
    const cpuStart = process.cpuUsage();
    const measuredStartedAt = new Date().toISOString();
    const start = performance.now();
    for (let run = 0; run < sampleCount; run += concurrency) {
      const wave = await Promise.all(
        Array.from({ length: Math.min(concurrency, sampleCount - run) }, async () => {
          const observed = await observer.observe(operation);
          const memory = captureMemory();
          return {
            status: observed.result.status,
            dbErrors: observed.metrics.dbErrors,
            totalMs: observed.totalMs,
            dbWaitSumMs: observed.metrics.dbWaitMs,
            heapUsedBytes: memory.heapUsed,
            rssBytes: memory.rss,
          };
        }),
      );
      measured.push(...wave);
    }
    const elapsedMs = performance.now() - start;
    const measuredFinishedAt = new Date().toISOString();
    const cpu = process.cpuUsage(cpuStart);
    const { statements, capture: _capture, ...transfer } = probe.metrics;
    if (probe.result.status === 200 && (!statements.length || !transfer.rows)) {
      if (test.id !== "search-absent") {
        throw new Error("Missing SQL observation or fixture candidates");
      }
    }
    const successful = measured.filter((sample) => sample.status === 200);
    const report = {
      startedAt,
      measuredStartedAt,
      measuredFinishedAt,
      warmupFailures,
      size,
      id: test.id,
      concurrency,
      parameters: test.parameters,
      samples: measured,
      summary: {
        totalMs: stats(successful.map((m) => m.totalMs)),
        allCompletionsMs: stats(measured.map((m) => m.totalMs)),
        successfulRequests: successful.length,
        failedRequests: measured.length - successful.length,
        dbWaitSumMs: stats(successful.map((m) => m.dbWaitSumMs)),
        elapsedMs,
        requestsPerSecond: (successful.length * 1000) / elapsedMs,
        processCpuMs: (cpu.user + cpu.system) / 1000,
        memoryBefore,
        memoryAfter: process.memoryUsage(),
        peakRssBytes,
        peakHeapUsedBytes,
        processLifetimeMaxRssBytes: process.resourceUsage().maxRSS * 1024,
      },
      transferProbe: transfer,
      sqlStatementsPerRequest: statements.length,
      resultProbe: probe.result,
    };
    appendFileSync(progressPath, `${JSON.stringify(report)}\n`);
    console.log(
      JSON.stringify({
        size,
        case: test.id,
        concurrency,
        totalMs: report.summary.totalMs,
        failedRequests: report.summary.failedRequests,
        dbWaitSumMs: report.summary.dbWaitSumMs,
        candidateRows: transfer.candidateRows,
        jsonBytes: transfer.jsonBytes,
      }),
    );
    if (test.plan && concurrency === 1) {
      writeReport(
        join(directory, `${size}-${test.id}.plan.json`),
        await observer.explain(statements),
      );
    }
    return report;
  } finally {
    clearInterval(timer);
  }
}

try {
  await harness.setup();
  const environment = await harness.scoped.query(
    "select version(),current_setting('shared_buffers') shared_buffers,current_setting('work_mem') work_mem,current_setting('max_parallel_workers_per_gather') max_parallel_workers_per_gather,current_setting('jit') jit",
  );
  const fixture = await seedCatalogBenchmark(harness, now);
  const measurements = [];
  const stabilityMeasurements = [];
  const catalogs = [];
  let previousSize = 80;
  for (const size of sizes) {
    console.log(`Preparing ${size} listings in owned schema ${harness.schema}`);
    const prepared = await growCatalogBenchmark(harness, previousSize, size);
    previousSize = size;
    catalogs.push({ size, ...prepared.counts });
    writeReport(join(directory, `${size}-catalog.json`), { size, ...prepared.counts });
    const scenarios = cases(prepared.exactIds);
    if (selectedCases?.some((id) => !scenarios.some((scenario) => scenario.id === id))) {
      throw new Error("Unknown benchmark case");
    }
    if (concurrencyMode !== "4") {
      const selectedScenarios = selectedCases
        ? [...new Set(selectedCases)].map((id) => scenarios.find((entry) => entry.id === id)!)
        : scenarios;
      for (const scenario of selectedScenarios) {
        measurements.push(await measure(scenario, size));
      }
    }
    if (concurrencyMode !== "1") {
      for (const id of ["search-wide-unit", "basket-mixed-20-standard"].filter(
        (entry) => !selectedCases || selectedCases.includes(entry),
      )) {
        const scenario = scenarios.find((s) => s.id === id)!;
        measurements.push(await measure(scenario, size, 4));
      }
    }
    if (args.includes("--diagnostics")) {
      writeReport(
        join(directory, `${size}-diagnostics.json`),
        await catalogBenchmarkDiagnostics(harness, observer, prepared.exactIds, now),
      );
    }
    if (size === 50_000 && stabilitySamples) {
      const scenario = scenarios.find((entry) => entry.id === "basket-mixed-20-standard")!;
      stabilityMeasurements.push(
        await measure({ ...scenario, id: `${scenario.id}-stability` }, size, 4, stabilitySamples),
      );
    }
  }
  writeReport(outputPath, {
    measuredAt: new Date().toISOString(),
    asOf: now.toISOString(),
    schema: harness.schema,
    runtime: process.version,
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    database: environment,
    scope:
      "Production search reader (includeComparisons:false) and actual local shopping POST handler; local PostgreSQL TCP max 4 connections, no Next HTTP or deployment",
    methodology: {
      sizes,
      selectedCases,
      concurrencyMode,
      failures:
        "All attempts are retained; totalMs and DB percentiles describe successful requests only; allCompletionsMs includes failures. Warmup failures are separate. Zero exit means measurement finished, not that the workload passed an availability target.",
      samples,
      stabilitySamples,
      stability:
        "Optional extra mixed-20 requests in waves of four at 50,000, after the selected matrix, in the same owned fixture; recorded separately from standard measurements",
      warmups,
      percentile: "nearest-rank; p95 only for >=20 samples; descriptive, no confidence interval",
      dbWaitSumMs:
        "Sum of client batch waits, including pool wait, PostgreSQL, transport and decoding; parallel statements overlap so this is not a component to subtract from totalMs",
      jsonBytes:
        "UTF-8 JSON of decoded SQL rows in excluded warmup, not wire bytes; nested candidates/history counted separately",
      memory:
        "Node process only; Warmups included in peaks; 10ms sampling plus request endpoints, synchronous peaks can be missed; maxRSS is process lifetime; GC before each case only",
      concurrency: `${samples} requests in waves of 4 for concurrent cases, shared process and max-4 connection pool; no arrival-rate load generator`,
      fixture:
        "80 real-writer templates across 4 retailers, 36 daily observations; volume clones preserve every fingerprint input, normalization, group membership and history. Linked timestamps shifted to first observation only for controlled temporal evidence. Repeated titles/identities are synthetic and do not model 50k unique products.",
    },
    fixture,
    catalogs,
    measurements,
    stabilityMeasurements,
  });
  console.log(`Saved ${outputPath}`);
} finally {
  try {
    await harness.dispose();
  } finally {
    await closeLocalTestConnections();
  }
}
