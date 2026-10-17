import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length) {
  throw new Error("Use verify-local.mjs /absolute/path/to/prepared-kit after building it");
}
const plan = JSON.parse(readFileSync(join(directory, "plan.json"), "utf8"));
assert.match(plan.runId, /^[0-9a-f]{32}$/u);
const source = resolve(directory, "source");
assert.equal(plan.source, source);
const require = createRequire(join(source, "apps/web/package.json"));
const { chromium, expect } = require("@playwright/test");
const allocator = createServer();
await new Promise((done) => allocator.listen(0, "127.0.0.1", done));
const address = allocator.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise((done) => allocator.close(done));
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString("hex");
const child = spawn(
  process.execPath,
  [
    "--import",
    resolve(import.meta.dirname, "deny-network.mjs"),
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: join(source, "apps/web"),
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTING_TEST_RUN_ID: plan.runId,
      HOSTING_TEST_SCHEMA: `comprafino_e2e_${"b".repeat(32)}`,
      HOSTING_TEST_SECRET: secret,
      HOSTING_TEST_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
      COMPRAFINO_TEST_DATABASE_MODE: "local",
      TEST_DATABASE_URL: "postgresql://comprafino_test@127.0.0.1:55432/comprafino_test",
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      GOOGLE_CLIENT_ID: "unused-local-smoke",
      GOOGLE_CLIENT_SECRET: "unused-local-smoke",
    },
  },
);
// Drain without printing potentially sensitive diagnostics. No credentials are real.
child.stderr.resume();
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error("Owned smoke server exited before becoming ready");
    }
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 401);
      ready = true;
      break;
    } catch {
      await delay(200);
    }
  }
  assert.ok(ready, "Test server did not reach its unauthorized boundary");
  const wrong = await fetch(origin, { headers: { authorization: "Bearer incorrect" } });
  assert.equal(wrong.status, 401);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${secret}` },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const response = await page.goto(origin);
  assert.equal(response?.status(), 200);
  await expect(page).toHaveTitle(/CompraFino/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compra mejor.Paga menos.");
  await page.getByLabel("¿Qué necesitas comprar?").fill("g");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByText("Escribe entre 2 y 120 caracteres", { exact: false })).toBeVisible();
  const blockedAuth = await context.request.get(`${origin}/api/auth/get-session`);
  assert.equal(blockedAuth.status(), 403);
  const marker = await context.request.get(`${origin}/api/hosting-test`);
  assert.equal(
    marker.status(),
    503,
    "A missing owned fixture must not report a ready test environment",
  );
  process.stdout.write(
    `${JSON.stringify({ runId: plan.runId, chromium: "passed", unauthenticated: 401, wrongSecret: 401, authorizedHome: 200, oauthDisabled: 403, missingFixture: 503, externalNetwork: "denied" })}\n`,
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((done) => child.once("exit", done));
}
