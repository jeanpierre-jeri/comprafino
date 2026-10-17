import {
  hostingReferencesSchema,
  hostingIdentitySchema,
  type HostingScenario,
} from "../../../../packages/db/src/testing/hosting/http-contract.ts";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { shoppingListSchema } from "@comprafino/core";
import { hostingReferences, concurrentHostingCases } from "./http-scenarios.ts";
import { evaluationDigest, validateSearchHtml, percentiles } from "../catalog-http-validation.ts";
import { closeLocalTestConnections } from "../../../../packages/db/src/testing/test-query-client.ts";

const [command, input, output, mode = "smoke", ...extra] = process.argv.slice(2);
if (
  !input ||
  !output ||
  extra.length ||
  !["references", "run"].includes(command ?? "") ||
  !["smoke", "matrix", "stability", "cancel"].includes(mode)
) {
  throw new Error(
    "Use references STATE OUTPUT | run REFERENCES OUTPUT [smoke|matrix|stability|cancel]",
  );
}
const load = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

// Reserve output before database/network work, outside the failure recorder so an
// existing evidence file is never appended to when exclusive creation fails.
writeFileSync(output, "", { flag: "wx", mode: 0o600 });
try {
  if (command === "references") {
    const references = await hostingReferences(load(input));
    writeFileSync(output, `${JSON.stringify(references, null, 2)}\n`);
  } else {
    const references = hostingReferencesSchema.parse(load(input));
    const { state, scenarios } = references;
    const origin = new URL(process.env.HOSTING_TEST_ORIGIN ?? "");
    if (
      origin.protocol !== "https:" ||
      !origin.hostname.startsWith(`comprafino-04a-${state.runId.slice(0, 8)}-`) ||
      !origin.hostname.endsWith(".vercel.app") ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.port ||
      process.env.HOSTING_TEST_RUN_ID !== state.runId
    ) {
      throw new Error("Expected the exact immutable deployment URL of this test project");
    }
    if (mode === "stability" && state.size !== 50000) {
      throw new Error("Stability requires 50000 fixtures");
    }
    const secret = process.env.HOSTING_TEST_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("Missing test access credential");
    }
    const started = Date.now();
    const maxBytes = 100 * 1024 * 1024;
    let bytes = 0;
    let requests = 0;
    const samples: { id: string; concurrency: number; ms: number }[] = [];
    const record = (value: unknown) => appendFileSync(output, `${JSON.stringify(value)}\n`);
    record({
      kind: "start",
      runId: state.runId,
      commit: state.commit,
      schema: state.schema,
      size: state.size,
      origin: origin.origin,
      mode,
      startedAt: new Date(started).toISOString(),
      limits: { maxRequests: 800, maxBytes, maxMinutes: 20, maxConcurrency: 4 },
    });
    function guard() {
      const now = new Date();
      if (
        Date.now() - started > 20 * 60 * 1000 ||
        requests >= 800 ||
        bytes >= maxBytes ||
        Date.now() - Date.parse(state.asOf) > 60 * 60 * 1000 ||
        now.toISOString().slice(0, 10) !== state.asOf.slice(0, 10) ||
        now.toLocaleDateString("en-CA", { timeZone: "America/Lima" }) !==
          new Date(state.asOf).toLocaleDateString("en-CA", { timeZone: "America/Lima" })
      ) {
        throw new Error("Run/fixture time, request or transfer budget exhausted");
      }
    }
    async function fetchBody(path: string, body?: string, abortMs?: number) {
      guard();
      requests += 1;
      const id = `${state.runId}-${randomUUID()}`;
      const start = performance.now();
      const headers: Record<string, string> = {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "accept-encoding": "identity",
        "x-benchmark-id": id,
      };
      if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
        headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      }
      const response = await fetch(new URL(path, origin), {
        method: body ? "POST" : "GET",
        body,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(abortMs ?? 40000),
        cache: "no-store",
      });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error(`Unexpected HTTP status ${response.status}`);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let responseBytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        responseBytes += chunk.value.byteLength;
        bytes += chunk.value.byteLength;
        if (responseBytes > 2 * 1024 * 1024 || bytes > maxBytes) {
          await reader.cancel();
          throw new Error("HTTP transfer budget exceeded");
        }
        chunks.push(chunk.value);
      }
      const ms = performance.now() - start;
      record({
        kind: "response",
        id,
        path,
        ms,
        bytes: responseBytes,
        vercelId: response.headers.get("x-vercel-id"),
        cache: response.headers.get("x-vercel-cache"),
      });
      return { text: Buffer.concat(chunks).toString("utf8"), ms };
    }
    const identity = hostingIdentitySchema.parse(
      JSON.parse((await fetchBody("/api/hosting-test")).text) as unknown,
    );
    if (
      identity.runId !== state.runId ||
      identity.commit !== state.commit ||
      identity.schema !== state.schema ||
      identity.size !== state.size
    ) {
      throw new Error("Deployment and fixture identity mismatch");
    }
    async function run(test: HostingScenario, concurrency: number, warmup = false) {
      if (test.kind === "basket") shoppingListSchema.parse(JSON.parse(test.body) as unknown);
      const response = await fetchBody(test.path, test.kind === "basket" ? test.body : undefined);
      if (test.kind === "search") {
        validateSearchHtml(response.text, test.expected);
      } else if (evaluationDigest(JSON.parse(response.text) as unknown) !== test.expected) {
        throw new Error("Complete HTTP basket differs from the reference reader");
      }
      record({ kind: "validated", scenario: test.id, concurrency, warmup, ms: response.ms });
      if (!warmup) samples.push({ id: test.id, concurrency, ms: response.ms });
    }
    async function wave(test: HostingScenario, warmup: boolean) {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => run(test, 4, warmup)),
      );
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("Concurrent wave failed; remaining waves stopped");
      }
    }
    if (mode === "smoke" || mode === "matrix") {
      for (const test of scenarios) {
        for (let index = 0; index < 2; index += 1) await run(test, 1, true);
        for (let index = 0; index < (mode === "matrix" ? 20 : 1); index += 1) await run(test, 1);
      }
      for (const test of scenarios.filter((scenario) =>
        concurrentHostingCases.includes(scenario.id),
      )) {
        for (let index = 0; index < 2; index += 1) await wave(test, true);
        for (let index = 0; index < (mode === "matrix" ? 5 : 1); index += 1) {
          await wave(test, false);
        }
      }
    } else if (mode === "stability") {
      for (const test of scenarios.filter((scenario) =>
        ["basket-mixed-20-standard", "basket-generic-5-standard"].includes(scenario.id),
      )) {
        for (let index = 0; index < 2; index += 1) await wave(test, true);
        for (let index = 0; index < 25; index += 1) await wave(test, false);
      }
    } else {
      for (const test of scenarios.filter((scenario) =>
        ["search-wide-unit", "basket-mixed-20-standard"].includes(scenario.id),
      )) {
        let outcome = "completed-before-abort";
        try {
          await fetchBody(test.path, test.kind === "basket" ? test.body : undefined, 100);
        } catch (error) {
          if (!(error instanceof Error) || !["TimeoutError", "AbortError"].includes(error.name)) {
            throw error;
          }
          outcome = "client-aborted-server-cancellation-unverified";
        }
        record({ kind: "abort", scenario: test.id, outcome });
        // Never infer SQL cancellation from a client timeout. Allow route budgets to
        // expire before recovery; dashboard/DB evidence is a separate acceptance gate.
        await delay(35000);
        await run(test, 1);
      }
    }
    record({
      kind: "complete",
      requests,
      bytes,
      durationMs: Date.now() - started,
      groups: [...new Set(samples.map((sample) => `${sample.id}:${sample.concurrency}`))].map(
        (key) => ({
          key,
          ...percentiles(
            samples
              .filter((sample) => `${sample.id}:${sample.concurrency}` === key)
              .map((sample) => sample.ms),
          ),
        }),
      ),
      serverCancellationVerified: false,
    });
  }
} catch {
  // Never echo credentials, request headers or driver error strings.
  appendFileSync(
    output,
    `${JSON.stringify({ kind: "failed", message: "Test stopped; inspect configuration, fixture identity and the preceding records" })}\n`,
  );
  process.exitCode = 1;
} finally {
  await closeLocalTestConnections();
}
