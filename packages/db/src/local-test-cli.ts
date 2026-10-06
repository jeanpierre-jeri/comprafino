import { spawn } from "node:child_process";

const [kind, ...args] = process.argv.slice(2);

if (kind !== "integration" && kind !== "history" && kind !== "shopping" && kind !== "basket") {
  throw new Error("Expected integration, history, shopping or basket");
}

const child = spawn(
  "pnpm",
  [
    ...(kind === "basket" ? ["--filter", "@comprafino/web"] : []),
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

  return testKind === "basket" ? "benchmark:basket" : "test:e2e:history";
}
