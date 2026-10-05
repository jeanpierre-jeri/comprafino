import { spawn } from "node:child_process";

const [kind, ...args] = process.argv.slice(2);
if (kind !== "integration" && kind !== "history" && kind !== "shopping")
  throw new Error("Expected integration, history or shopping");
const child = spawn(
  "pnpm",
  [
    kind === "integration" ? "test:integration" : "test:e2e:history",
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
