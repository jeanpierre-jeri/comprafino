import { spawn } from "node:child_process";

const [kind, ...args] = process.argv.slice(2);

if (
  kind !== "integration" &&
  kind !== "history" &&
  kind !== "shopping" &&
  kind !== "basket" &&
  kind !== "catalog" &&
  kind !== "catalog-http"
) {
  throw new Error("Expected integration, history, shopping, basket, catalog or catalog-http");
}

const child = spawn(
  "pnpm",
  [
    ...(kind === "basket" || kind === "catalog" || kind === "catalog-http"
      ? ["--filter", "@comprafino/web"]
      : []),
    testCommand(kind),
    ...(kind === "shopping" ? ["--shopping-list"] : []),
    ...args,
  ],
  {
    cwd: new URL("../../../", import.meta.url),
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: "postgresql://comprafino_test@127.0.0.1:55432/comprafino_test",
      COMPRAFINO_TEST_DATABASE_MODE: "local",
    },
  },
);

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

function testCommand(testKind: string): string {
  if (testKind === "integration") return "test:integration";

  if (testKind === "catalog") return "benchmark:catalog";

  if (testKind === "catalog-http") return "benchmark:catalog:http";

  return testKind === "basket" ? "benchmark:basket" : "test:e2e:history";
}
