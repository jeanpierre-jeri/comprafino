import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { cpus, totalmem } from "node:os";
import {
  parseBenchmarkEvent,
  parseBenchmarkStatements,
} from "../../../packages/db/src/testing/http-benchmark-events.ts";
import { searchFilters, shoppingListEvaluationSchema, unitPriceBases } from "@comprafino/core";
import { searchFilterQuery } from "@comprafino/core/search-filters";
import { searchPublicProducts, evaluateCurrentShoppingList, formatPen } from "@comprafino/db";
import { ownedTestDatabase } from "../../../packages/db/src/testing/database.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";
import { fixtureDatabaseUrl } from "../../../packages/db/src/testing/fixture-url.ts";
import {
  seedCatalogBenchmark,
  growCatalogBenchmark,
} from "../../../packages/db/src/testing/catalog-benchmark-fixtures.ts";
import {
  catalogBenchmarkObserver,
  benchmarkFailure,
} from "../../../packages/db/src/testing/catalog-benchmark-observer.ts";
import { reportOutputPath, writeReport } from "../../../packages/db/src/report-output.ts";
import {
  catalogSearchCases,
  catalogBasketCases,
  makeCatalogList,
} from "./catalog-benchmark-workloads.ts";
import { authTestEnv } from "./auth-env.ts";
import { statementBudgetSql } from "../../../packages/db/src/statement-budget.ts";
import {
  digest,
  evaluationDigest,
  percentiles,
  validateSearchHtml,
} from "./catalog-http-validation.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (
  args.some(
    (arg) =>
      arg !== "--fault-probes" &&
      !/^--(output|sizes|samples|warmups|stability-samples|cases|concurrency)=/u.test(arg),
  )
) {
  throw new Error(
    "Use --output=path --sizes=2000,10000,50000 --samples=20 --warmups=2 --stability-samples=100 --cases=id,id --concurrency=1|4|both",
  );
}
const sizes = (option("sizes") ?? "2000,10000,50000").split(",").map(Number);
const samples = Number(option("samples") ?? 20);
const warmups = Number(option("warmups") ?? 2);
const stabilitySamples = Number(option("stability-samples") ?? 0);
const concurrencyMode = option("concurrency") ?? "both";
const selectedCases = option("cases")?.split(",");
const faultProbes = args.includes("--fault-probes");
if (
  sizes.some(
    (size, index) =>
      ![2000, 10000, 50000].includes(size) || (index > 0 && size <= sizes[index - 1]!),
  ) ||
  !Number.isInteger(samples) ||
  samples < 2 ||
  samples > 100 ||
  !Number.isInteger(warmups) ||
  warmups < 1 ||
  warmups > 10 ||
  !Number.isInteger(stabilitySamples) ||
  (stabilitySamples !== 0 &&
    (stabilitySamples < 20 ||
      stabilitySamples > 100 ||
      stabilitySamples % 4 !== 0 ||
      !sizes.includes(50000))) ||
  !["1", "4", "both"].includes(concurrencyMode)
) {
  throw new Error("Invalid HTTP benchmark selection");
}
if (process.env.COMPRAFINO_TEST_DATABASE_MODE !== "local") {
  throw new Error("HTTP benchmark requires the explicit owned local test transport");
}
const output = reportOutputPath([
  `--output=${option("output") ?? `.artifacts/catalog-http-${new Date().toISOString().replaceAll(":", "-")}/results.json`}`,
]);
const directory = dirname(output);
mkdirSync(directory, { recursive: true });
const tracePath = join(directory, "server-events.jsonl");
const progressPath = `${output}.progress.jsonl`;
for (const path of [tracePath, progressPath]) {
  writeFileSync(path, "", { flag: "wx" });
}
const harness = ownedTestDatabase();
const observer = catalogBenchmarkObserver(harness);
const now = new Date();
const timeoutMs = 90_000;
const concurrentIds = [
  "search-wide-unit",
  "search-category-text",
  "basket-mixed-20-standard",
  "basket-generic-5-standard",
];
type Scenario = {
  id: string;
  path: string;
  body?: string;
  parameters: Record<string, unknown>;
  validate: (body: string) => unknown;
};
type Event = ReturnType<typeof parseBenchmarkEvent>;
const events = new Map<string, Event[]>();
const drains = new Map<string, () => void>();
let server: ReturnType<typeof spawn> | undefined;
let serverExited = Promise.resolve();
let baseUrl = "";

async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing owned HTTP port");
  }
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function startServer() {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const log = join(directory, "server.log");
  writeFileSync(log, "", { flag: "wx" });
  server = spawn(
    process.execPath,
    [
      "--import",
      "../../packages/db/src/testing/http-benchmark-preload.ts",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: new URL("../", import.meta.url),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        ...authTestEnv,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        BETTER_AUTH_URL: baseUrl,
        DATABASE_URL: fixtureDatabaseUrl(harness.url, "local"),
        COMPRAFINO_E2E_SCHEMA: harness.schema,
        COMPRAFINO_BENCHMARK_FAULTS: faultProbes ? "1" : "0",
      },
    },
  );
  server.stdout?.on("data", (chunk: Buffer) => appendFileSync(log, chunk));
  server.stderr?.on("data", (chunk: Buffer) => appendFileSync(log, chunk));
  const child = server;
  // Register before startup: a signal-terminated child keeps exitCode null, and
  // attaching a fresh exit listener during teardown can miss its earlier exit.
  serverExited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let startupError: Error | undefined;
  server.on("error", (error) => {
    startupError = error;
  });
  server.on("message", (value: unknown) => {
    const event = parseBenchmarkEvent(value);
    appendFileSync(tracePath, `${JSON.stringify(event)}\n`);
    if (event.id) {
      const requestEvents = events.get(event.id) ?? [];
      requestEvents.push(event);
      events.set(event.id, requestEvents);
    }
    if (event.type === "drained" && event.token) {
      drains.get(event.token)?.();
      drains.delete(event.token);
    }
  });
  for (let attempt = 0; attempt < 240; attempt++) {
    if (startupError) {
      throw startupError;
    }
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Next server exited: ${server.exitCode}; see ${log}`);
    }
    try {
      const response = await fetch(`${baseUrl}/search`, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* The owned server has not started listening yet. */
    }
    await delay(250);
  }
  throw new Error("Next production startup deadline exceeded");
}

async function drain() {
  const child = server;
  if (!child?.connected || child.exitCode !== null || child.signalCode !== null) {
    throw new Error("Benchmark server is unavailable");
  }
  const token = randomUUID();
  await new Promise<void>((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer);
      drains.delete(token);
      reject(new Error("Owned benchmark server exited before its work settled"));
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      drains.delete(token);
      reject(new Error("Owned HTTP/SQL/after work did not settle within 90 seconds"));
    }, timeoutMs);
    child.once("exit", onExit);
    drains.set(token, () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve();
    });
    child.send({ type: "drain", token });
  });
}

async function prepareScenarios(exactIds: string[], size: number) {
  const scenarios: Scenario[] = [];
  const references = [];
  for (const test of catalogSearchCases()) {
    if (selectedCases && !selectedCases.includes(test.id)) continue;

    const filters = searchFilters(test.params);
    const observed = await observer.observe(() =>
      searchPublicProducts(observer.db, test.query, filters.sort, now, filters, test.page, {
        includeComparisons: false,
      }),
    );
    const result = observed.result;
    let offers = [...result.offers];
    if (filters.sort === "unit-price") {
      const groups = [...unitPriceBases, "unknown"];
      offers = offers.sort(
        (left, right) =>
          groups.indexOf(left.unitPrice?.basis ?? "unknown") -
          groups.indexOf(right.unitPrice?.basis ?? "unknown"),
      );
    } else if (filters.sort === "total-price") {
      offers = offers.sort(
        (left, right) => Number(left.pricingBasis === "kg") - Number(right.pricingBasis === "kg"),
      );
    }
    const expected = {
      ids: offers.map((offer) => offer.id),
      groups:
        filters.sort === "unit-price"
          ? [...unitPriceBases, "unknown"].map((basis) =>
              offers
                .filter((offer) => (offer.unitPrice?.basis ?? "unknown") === basis)
                .map((offer) => offer.id),
            )
          : [offers.map((offer) => offer.id)],
      prices: offers.map((offer) => ({
        id: offer.id,
        ordinary: formatPen(offer.currentPriceCents),
        conditional: offer.conditionalOffers.map((benefit) => formatPen(benefit.priceCents)),
      })),
      totalOffers: result.totalOffers,
      page: test.page,
      hasMore: result.hasMore,
    };
    references.push({
      id: test.id,
      readerMs: observed.totalMs,
      dbWaitSumMs: observed.metrics.dbWaitMs,
      expected,
    });
    scenarios.push({
      id: test.id,
      path: `/search?${searchFilterQuery(test.query, filters)}&page=${test.page}`,
      parameters: { ...test, filters },
      validate: (html) => validateSearchHtml(html, expected),
    });
  }
  for (const test of catalogBasketCases()) {
    const id = `basket-${test.composition}-${test.count}-${test.mode}`;
    if (selectedCases && !selectedCases.includes(id)) continue;

    const list = makeCatalogList(now, exactIds, test.count, test.composition);
    const observed = await observer.observe(() =>
      evaluateCurrentShoppingList(observer.db, list, test.mode, now),
    );
    const expectedDigest = evaluationDigest(observed.result);
    references.push({
      id,
      readerMs: observed.totalMs,
      dbWaitSumMs: observed.metrics.dbWaitMs,
      expectedDigest,
      result: observed.result,
    });
    scenarios.push({
      id,
      path: `/api/list/evaluate?priceMode=${test.mode}`,
      body: JSON.stringify(list),
      parameters: test,
      validate: (body) => {
        const value: unknown = JSON.parse(body);
        const evaluation = shoppingListEvaluationSchema.parse(value);
        if (evaluationDigest(evaluation) !== expectedDigest) {
          throw new Error("Complete HTTP basket decisions differ from the production reader");
        }
        return {
          decisionDigest: expectedDigest,
          timings: evaluation.timings,
          baskets: evaluation.baskets.map((basket) => ({
            maxRetailers: basket.maxRetailers,
            totalCostCents: basket.totalCostCents,
          })),
        };
      },
    });
  }
  if (selectedCases?.some((id) => !scenarios.some((scenario) => scenario.id === id))) {
    throw new Error("Unknown HTTP benchmark case");
  }
  writeReport(join(directory, `${size}-references.json`), references);
  return scenarios;
}

async function request(
  test: Scenario,
  probe = false,
  abortAfterMs?: number,
  fault?: "sql-timeout",
) {
  const id = randomUUID();
  const startedAt = Date.now();
  const started = performance.now();
  let status: number | null = null;
  let headersMs: number | null = null;
  let bodyMs: number | null = null;
  let bytes = 0;
  let serverTiming: string | null = null;
  let result: unknown;
  let failure: ReturnType<typeof benchmarkFailure> | null = null;
  let content = "";
  try {
    const response = await fetch(`${baseUrl}${test.path}`, {
      method: test.body ? "POST" : "GET",
      body: test.body,
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "x-benchmark-id": id,
        "x-benchmark-probe": probe ? "1" : "0",
        ...(fault ? { "x-benchmark-fault": fault } : {}),
      },
      signal: AbortSignal.timeout(abortAfterMs ?? timeoutMs),
    });
    status = response.status;
    headersMs = performance.now() - started;
    serverTiming = response.headers.get("server-timing");
    const buffer = await response.arrayBuffer();
    bodyMs = performance.now() - started;
    bytes = buffer.byteLength;
    content = new TextDecoder().decode(buffer);
    if (!response.ok) {
      throw new Error(`HTTP ${status}: ${content.slice(0, 300)}`);
    }
    result = test.validate(content);
  } catch (error) {
    failure =
      error instanceof Error
        ? { message: `${error.name}: ${error.message}` }
        : benchmarkFailure(error);
  }
  const completionMs = performance.now() - started;
  if (probe || failure) {
    writeFileSync(join(directory, `${id}.${test.body ? "json" : "html"}`), content, { flag: "wx" });
  }
  return {
    id,
    startedAt,
    status,
    headersMs,
    bodyMs,
    completionMs,
    bytes,
    serverTiming,
    result,
    failure,
    bodyDigest: digest(content),
  };
}

async function measure(
  test: Scenario,
  size: number,
  concurrency: number,
  count = samples,
  phase = "matrix",
) {
  const startedAt = Date.now();
  const warmupResults = [];
  for (let round = 0; round < warmups; round++) {
    warmupResults.push(
      ...(await Promise.all(
        Array.from({ length: concurrency }, (_, index) =>
          request(test, round === 0 && index === 0),
        ),
      )),
    );
    await drain();
  }
  const measuredStartedAt = Date.now();
  const results = [];
  for (let index = 0; index < count; index += concurrency) {
    results.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(concurrency, count - index) }, () => request(test)),
      )),
    );
    // Do not leave post-response writes or uncanceled SQL to contaminate the next wave.
    await drain();
  }
  const measuredFinishedAt = Date.now();
  const complete = (entry: Awaited<ReturnType<typeof request>>) => ({
    ...entry,
    events: events.get(entry.id) ?? [],
  });
  const successful = results.filter((entry) => !entry.failure);
  const workErrors = (entries: Awaited<ReturnType<typeof request>>[]) => {
    const related = entries.flatMap((entry) => events.get(entry.id) ?? []);
    return {
      sql: related.filter((event) => event.type === "sql-end" && event.error).length,
      transport: related.filter((event) => event.type === "fetch-error").length,
      after: related.filter((event) => event.type === "after-end" && event.ok === false).length,
    };
  };
  const report = {
    size,
    id: test.id,
    concurrency,
    maximumMeasuredConcurrency: Math.min(concurrency, count),
    phase,
    parameters: test.parameters,
    path: test.path,
    startedAt,
    measuredStartedAt,
    measuredFinishedAt,
    summary: {
      attempted: results.length,
      failed: results.length - successful.length,
      // A valid streamed response can still leave a failed after() write. Surface
      // those errors in progress/output rather than relying only on HTTP success.
      workErrors: workErrors(results),
      warmupWorkErrors: workErrors(warmupResults),
      headersMs: percentiles(
        successful.flatMap((entry) => (entry.headersMs === null ? [] : [entry.headersMs])),
      ),
      bodyMs: percentiles(
        successful.flatMap((entry) => (entry.bodyMs === null ? [] : [entry.bodyMs])),
      ),
      allCompletionsMs: percentiles(results.map((entry) => entry.completionMs)),
      bytes: percentiles(successful.map((entry) => entry.bytes)),
    },
    warmups: warmupResults.map(complete),
    samples: results.map(complete),
  };
  appendFileSync(progressPath, `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify({ size, id: test.id, concurrency, phase, ...report.summary }));
  if (concurrency === 1 && phase === "matrix") {
    const probe = warmupResults[0]!;
    const statements = (events.get(probe.id) ?? [])
      .filter((event) => event.type === "sql-start" && event.afterFinish === false)
      .flatMap((event) => parseBenchmarkStatements(event.statements))
      // Preserve the captured prelude in traces; EXPLAIN only the unchanged domain SQL.
      .filter((statement) => statement.query !== statementBudgetSql);
    // Only explain read statements. Never execute captured after-response mutations again.
    if (statements.some((statement) => !/^\s*(select|with)\b/iu.test(statement.query))) {
      throw new Error("Unexpected foreground mutation in HTTP benchmark");
    }
    if (
      [
        "search-wide-relevance",
        "search-category-text",
        "basket-mixed-20-standard",
        "basket-generic-5-standard",
      ].includes(test.id)
    ) {
      writeReport(
        join(directory, `${size}-${test.id}.plan.json`),
        await observer.explain(statements),
      );
    }
  }
  for (const entry of [...warmupResults, ...results]) {
    events.delete(entry.id);
  }
  return report;
}

const measurements = [];
const stabilityMeasurements = [];
const cancellations = [];
const faultResults = [];
let completed = false;
try {
  await harness.setup();
  const database = await harness.scoped.query(
    "select version(), current_setting('shared_buffers') shared_buffers, current_setting('work_mem') work_mem, current_setting('hash_mem_multiplier') hash_mem_multiplier, current_setting('max_parallel_workers_per_gather') max_parallel_workers_per_gather, current_setting('enable_parallel_hash') enable_parallel_hash, current_setting('jit') jit, current_setting('dynamic_shared_memory_type') dynamic_shared_memory_type",
  );
  const fixture = await seedCatalogBenchmark(harness, now);
  await startServer();
  console.log(
    `HTTP benchmark server PID ${server?.pid}, ${baseUrl}, owned schema ${harness.schema}`,
  );
  let previousSize = 80;
  for (const size of sizes) {
    console.log(`Preparing ${size} listings`);
    const prepared = await growCatalogBenchmark(harness, previousSize, size);
    previousSize = size;
    writeReport(join(directory, `${size}-catalog.json`), { size, ...prepared.counts });
    const scenarios = await prepareScenarios(prepared.exactIds, size);
    if (concurrencyMode !== "4") {
      for (const scenario of scenarios) {
        measurements.push(await measure(scenario, size, 1));
      }
    }
    if (concurrencyMode !== "1") {
      for (const scenario of scenarios.filter((entry) => concurrentIds.includes(entry.id))) {
        measurements.push(await measure(scenario, size, 4));
      }
    }
    if (size === 50000 && stabilitySamples) {
      for (const id of ["basket-mixed-20-standard", "basket-generic-5-standard"]) {
        const scenario = scenarios.find((entry) => entry.id === id);
        if (!scenario) {
          throw new Error("Stability requires both mixed and generic basket cases");
        }
        stabilityMeasurements.push(await measure(scenario, size, 4, stabilitySamples, "stability"));
      }
    }
    // Separate diagnostic cancellations, followed by a complete successful request.
    for (const scenario of scenarios.filter((entry) =>
      ["search-wide-unit", "basket-mixed-20-standard"].includes(entry.id),
    )) {
      const canceled = await request(scenario, false, 100);
      await drain();
      const recovered = await request(scenario);
      await drain();
      cancellations.push({
        size,
        id: scenario.id,
        canceled: { ...canceled, events: events.get(canceled.id) },
        recovered: { ...recovered, events: events.get(recovered.id) },
      });
      events.delete(canceled.id);
      events.delete(recovered.id);
    }
    if (faultProbes && size === sizes[0]) {
      for (const scenario of scenarios.filter((entry) =>
        ["search-wide-unit", "basket-mixed-20-standard"].includes(entry.id),
      )) {
        for (const kind of ["timeout", "abort"] as const) {
          const failed = await request(
            scenario,
            true,
            kind === "abort" ? 100 : undefined,
            "sql-timeout",
          );
          await drain();
          const failedEvents = events.get(failed.id) ?? [];
          const sqlCanceled = failedEvents.some(
            (event) =>
              event.type === "sql-end" &&
              typeof event.error === "object" &&
              event.error !== null &&
              "code" in event.error &&
              event.error.code === "57014",
          );
          if (
            !failed.failure ||
            !sqlCanceled ||
            !failedEvents.some((event) => event.type === "fault-injected")
          ) {
            throw new Error("Slow SQL probe did not fail and cancel PostgreSQL as expected");
          }
          const recovered = await request(scenario);
          await drain();
          if (recovered.failure) {
            throw new Error("HTTP recovery after controlled SQL failure failed");
          }

          faultResults.push({
            size,
            id: scenario.id,
            kind,
            failed: { ...failed, events: failedEvents },
            recovered: { ...recovered, events: events.get(recovered.id) },
          });
          events.delete(failed.id);
          events.delete(recovered.id);
        }
      }
    }
  }
  writeReport(output, {
    measuredAt: new Date().toISOString(),
    asOf: now.toISOString(),
    schema: harness.schema,
    runtime: process.version,
    nextVersion: "16.3.8",
    buildId: readFileSync(new URL("../.next/BUILD_ID", import.meta.url), "utf8").trim(),
    machine: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      platform: process.platform,
      arch: process.arch,
    },
    database,
    fixture,
    methodology: {
      sizes,
      samples,
      warmups,
      stabilitySamples,
      concurrencyMode,
      selectedCases,
      faultProbes,
      timeoutMs,
      scope:
        "Production next start over loopback HTTP; explicit owned local Neon-wire fixture transport; no browser hydration/assets or deployment network",
      latency:
        "headersMs ends when fetch exposes headers; bodyMs ends after the full uncompressed body; completionMs includes client validation. Percentiles use successful complete validated bodies only; p95 needs >=20 successes.",
      phases:
        "Server event timestamps include request, SQL wire transport start/end, response finish/close, Next waitUntil completion. SQL excludes subsequent Neon parsing/domain/render work. Basket Server-Timing is the existing handler metric. Search post-transport residual includes domain normalization, React rendering and serialization; it is not isolated React CPU.",
      cancellation:
        "90s benchmark client deadline; production operation, fetch and statement budgets apply. Local fetch abort does not itself cancel SQL; tracked transport and Next after promises settle before another wave or teardown. Optional first-scale slow SQL probes are excluded from latency samples.",
      references:
        "One excluded reader invocation per case supplies complete basket decisions (excluding evaluatedAt/timings) or exact search IDs, order within comparable groups, prices and pagination. These single observations are not reader percentiles.",
      concurrency:
        "Closed waves of four, max-four PostgreSQL connections in the server pool; after-response work drains between waves. Extra stability covers mixed and exclusively generic baskets.",
      memory:
        "Server RSS/heap and lifetime maxRSS sampled by IPC every100ms. Synchronous peaks may be missed; separate container monitoring is required for PostgreSQL/shared memory. Client and server are distinct processes on one host.",
    },
    measurements,
    stabilityMeasurements,
    cancellations,
    faultResults,
  });
  completed = true;
  console.log(`Saved ${output}`);
} finally {
  let stopped = true;
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    try {
      await drain();
    } catch (error) {
      appendFileSync(
        progressPath,
        `${JSON.stringify({ teardownDrainError: benchmarkFailure(error) })}\n`,
      );
    }
    const child = server;
    stopped = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15_000);
      void serverExited.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
      child.kill("SIGTERM");
    });
    if (!stopped) {
      // Only our own child; do not remove its schema while it can still write.
      child.kill("SIGKILL");
      await serverExited;
      stopped = true;
    }
  }
  try {
    await harness.dispose();
    writeReport(join(directory, "cleanup.json"), {
      completed,
      serverStopped: stopped,
      ownedSchemaRemoved: harness.schema,
      at: new Date().toISOString(),
    });
  } finally {
    await closeLocalTestConnections();
  }
}
