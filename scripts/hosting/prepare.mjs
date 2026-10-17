import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const [revision, ...extra] = process.argv.slice(2);
if (!revision || extra.length || !/^[0-9a-f]{40}$/u.test(revision)) {
  throw new Error("Supply an explicit full reviewed commit SHA; no branch or working-tree export");
}
const commit = execFileSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], {
  cwd: root,
  encoding: "utf8",
}).trim();
const runId = randomUUID().replaceAll("-", "");
const directory = join(root, ".artifacts", "hosting-04a", runId);
const source = join(directory, "source");
mkdirSync(source, { recursive: true });
// git archive excludes .env, untracked files and all unrelated work in progress.
const archive = execFileSync("git", ["archive", commit], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
});
execFileSync("tar", ["-x", "-C", source], { input: archive });
const overlays = [];
function save(path, content) {
  const destination = join(source, path);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  writeFileSync(destination, content, { mode: 0o600 });
  overlays.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
}
function replaceOnce(content, before, after) {
  if (content.split(before).length !== 2) {
    throw new Error(
      "Reviewed baseline changed; inspect the overlay before preparing another revision",
    );
  }
  return content.replace(before, after);
}
for (const forbidden of [
  "apps/web/src/proxy.ts",
  "apps/web/src/middleware.ts",
  "apps/web/vercel.json",
  "vercel.json",
]) {
  if (existsSync(join(source, forbidden))) {
    throw new Error("Baseline already configures routing or hosting; review the overlay first");
  }
}
for (const file of [
  "config.ts",
  "fixtures.ts",
  "fixture-cli.ts",
  "http-contract.ts",
  "identity.ts",
]) {
  save(
    `packages/db/src/testing/hosting/${file}`,
    readFileSync(join(root, "packages/db/src/testing/hosting", file), "utf8"),
  );
}
let fixtures = readFileSync(
  join(source, "packages/db/src/testing/catalog-benchmark-fixtures.ts"),
  "utf8",
);
fixtures = replaceOnce(
  fixtures,
  "type Harness = ReturnType<typeof ownedTestDatabase>;",
  'type Harness = Pick<ReturnType<typeof ownedTestDatabase>, "db" | "scoped">;',
);
save("packages/db/src/testing/catalog-benchmark-fixtures.ts", fixtures);
let client = readFileSync(join(source, "packages/db/src/client.ts"), "utf8");
client = replaceOnce(
  client,
  'import { requireDatabaseUrl } from "./env.ts";',
  'import { hostingRuntimeConfig } from "./testing/hosting/config.ts";\nimport { testSchemaClient } from "./testing/test-schema-client.ts";',
);
client = replaceOnce(
  client,
  "const client = neon(requireDatabaseUrl(env), { fetchOptions });",
  "const test = hostingRuntimeConfig(env);\n  const client = testSchemaClient(neon(test.url, { fetchOptions }), test.schema);",
);
save("packages/db/src/client.ts", client);
for (const [template, destination] of [
  ["proxy.ts.template", "apps/web/src/proxy.ts"],
  ["identity.ts.template", "apps/web/src/app/api/hosting-test/route.ts"],
]) {
  save(
    destination,
    readFileSync(join(root, "scripts/hosting", template), "utf8")
      .replaceAll("__RUN_ID__", runId)
      .replaceAll("__COMMIT__", commit),
  );
}
save(
  "apps/web/vercel.json",
  `${JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", regions: ["iad1"], fluid: true }, null, 2)}\n`,
);
for (const file of ["http-cli.ts", "http-scenarios.ts"]) {
  const path = `apps/web/testing/hosting/${file}`;
  save(path, readFileSync(join(root, path), "utf8"));
}
// Keep control scripts outside the upload; no deployment or provider CLI is invoked.
cpSync(join(root, "scripts/hosting/environment.example"), join(directory, "environment.example"));
writeFileSync(
  join(directory, "plan.json"),
  `${JSON.stringify({ version: 1, runId, commit, source, overlays, remoteResourcesCreated: false, suggestedProject: `comprafino-04a-${runId.slice(0, 8)}`, suggestedDatabase: `comprafino_hosting_${runId.slice(0, 8)}`, regions: ["iad1"], sizes: [2000, 10000, 50000], maxConcurrency: 4 }, null, 2)}\n`,
);
process.stdout.write(`${directory}\n`);
