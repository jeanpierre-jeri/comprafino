import { AsyncLocalStorage } from "node:async_hooks";
import { IncomingMessage, Server, ServerResponse } from "node:http";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { abortableFixtureFetch } from "./abortable-fixture-fetch.ts";
import { statementBudgetSql } from "../statement-budget.ts";

await import("./http-preload.ts");

// Only the explicit benchmark child imports this file. Ordinary Next start does not.
if (!process.send || process.env.COMPRAFINO_TEST_DATABASE_MODE !== "local") {
  throw new Error("HTTP benchmark requires an IPC child and the owned local transport");
}

type Context = {
  id: string;
  probe: boolean;
  finishedAt?: number;
  fault?: "sql-timeout";
  faultInjected?: boolean;
};
const storage = new AsyncLocalStorage<Context>();
let activeRequests = 0;
let activeTransports = 0;
let activeAfter = 0;
let lastActivity = performance.now();

function send(event: Record<string, unknown>) {
  lastActivity = performance.now();
  process.send?.({ ...event, at: performance.timeOrigin + performance.now() });
}

// Preserve the method's receiver explicitly below for every forwarded event.
/* oxlint-disable typescript/unbound-method */
const originalEmit: (this: Server, event: string, ...args: unknown[]) => boolean =
  Server.prototype.emit;
/* oxlint-enable typescript/unbound-method */
Server.prototype.emit = function (event: string, ...args: unknown[]) {
  const [request, response] = args;
  if (
    event !== "request" ||
    !(request instanceof IncomingMessage) ||
    !(response instanceof ServerResponse)
  ) {
    return originalEmit.call(this, event, ...args);
  }
  const id = request.headers["x-benchmark-id"];
  if (typeof id !== "string" || !/^[a-z0-9-]{1,120}$/u.test(id)) {
    return originalEmit.call(this, event, ...args);
  }
  const context: Context = { id, probe: request.headers["x-benchmark-probe"] === "1" };
  if (
    process.env.COMPRAFINO_BENCHMARK_FAULTS === "1" &&
    request.headers["x-benchmark-fault"] === "sql-timeout"
  ) {
    context.fault = "sql-timeout";
  }
  activeRequests++;
  send({ type: "request", id, url: request.url });
  response.once("finish", () => {
    context.finishedAt = performance.now();
    send({ type: "finish", id, status: response.statusCode });
  });
  response.once("close", () => {
    activeRequests--;
    send({ type: "close", id, completed: response.writableFinished });
  });
  return storage.run(context, () => originalEmit.call(this, event, ...args));
};

// The documented Next 16.3.8 platform request context exposes completion of after().
// We observe its promise, without skipping or delaying its callback.
const requestContextKey = Symbol.for("@next/request-context");
if (Reflect.has(globalThis, requestContextKey)) {
  throw new Error("Benchmark must not replace an existing platform request context");
}
Reflect.set(globalThis, requestContextKey, {
  get() {
    const context = storage.getStore();
    if (!context) return undefined;

    return {
      waitUntil(promise: Promise<unknown>) {
        activeAfter++;
        send({ type: "after-scheduled", id: context.id });
        void promise
          .then(
            () => send({ type: "after-end", id: context.id, ok: true }),
            () => send({ type: "after-end", id: context.id, ok: false }),
          )
          .finally(() => {
            activeAfter--;
          });
      },
    };
  },
});

const statementSchema = z.object({ query: z.string(), params: z.array(z.unknown()) });
const transportFetch = globalThis.fetch;
const measuredFetch: typeof fetch = async (input, init) => {
  if (!new Headers(init?.headers).has("Neon-Connection-String")) {
    return transportFetch(input, init);
  }
  const context = storage.getStore();
  if (context?.fault && !context.faultInjected) {
    const body = z
      .object({ queries: z.array(statementSchema) })
      .parse(JSON.parse(typeof init?.body === "string" ? init.body : "null") as unknown);
    if (body.queries[0]?.query !== statementBudgetSql) {
      throw new Error("SQL fault probes require the production statement budget");
    }
    context.faultInjected = true;
    body.queries.splice(1, 0, { query: "select pg_sleep(20)", params: [] });
    init = { ...init, body: JSON.stringify(body) };
    send({ type: "fault-injected", id: context.id, fault: context.fault });
  }
  const id = context?.id ?? "unattributed";
  const token = `${id}-${performance.now()}`;
  let statements;
  if (context?.probe && typeof init?.body === "string") {
    const value: unknown = JSON.parse(init.body);
    const batch = z.object({ queries: z.array(statementSchema) }).safeParse(value);
    statements = batch.success ? batch.data.queries : [statementSchema.parse(value)];
  }
  activeTransports++;
  send({
    type: "sql-start",
    id,
    token,
    afterFinish: context?.finishedAt !== undefined,
    statements,
  });
  // Keep the real transport tracked even if fetch's signal rejects first.
  const transport = transportFetch(input, init)
    .then(
      async (response) => {
        let error: unknown;
        if (!response.ok) {
          error = await response.clone().json();
        }
        send({ type: "sql-end", id, token, status: response.status, error });
        return response;
      },
      (error: unknown) => {
        send({ type: "sql-end", id, token, error: String(error) });
        throw error;
      },
    )
    .finally(() => {
      activeTransports--;
    });
  try {
    return await abortableFixtureFetch(transport, init?.signal);
  } catch (error) {
    send({
      type: "fetch-error",
      id,
      token,
      error: String(error),
      aborted: init?.signal?.aborted ?? false,
    });
    throw error;
  }
};
globalThis.fetch = measuredFetch;
neonConfig.fetchFunction = measuredFetch;

const commandSchema = z.object({ type: z.literal("drain"), token: z.string() });
process.on("message", (value: unknown) => {
  const command = commandSchema.parse(value);
  const timer = setInterval(() => {
    if (
      activeRequests ||
      activeTransports ||
      activeAfter ||
      performance.now() - lastActivity < 100
    ) {
      return;
    }

    clearInterval(timer);
    send({ type: "drained", token: command.token });
  }, 25);
});

setInterval(() => {
  process.send?.({
    type: "memory",
    at: Date.now(),
    pid: process.pid,
    ...process.memoryUsage(),
    maxRssKiB: process.resourceUsage().maxRSS,
    cpu: process.cpuUsage(),
    activeRequests,
    activeTransports,
    activeAfter,
  });
}, 100).unref();
