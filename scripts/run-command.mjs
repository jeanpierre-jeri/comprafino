import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write("Missing command.\n");
  process.exitCode = 1;
} else {
  const enabled =
    (process.stderr.isTTY || process.env.COMPRAFINO_PROGRESS === "1") &&
    process.env.NODE_ENV !== "production" &&
    !process.env.CI &&
    !process.env.GITHUB_ACTIONS &&
    process.env.COMPRAFINO_PROGRESS !== "0" &&
    !process.env.COMPRAFINO_PROGRESS_MANAGED;
  const startedAt = Date.now();
  // A lifecycle name is safe to display; arguments may contain credentials.
  const name = process.env.npm_lifecycle_event ?? "comando";
  const report = (state) => {
    if (enabled) {
      process.stderr.write(
        `[${name}] ${state} | ${Math.floor((Date.now() - startedAt) / 1000)}s\n`,
      );
    }
  };
  report("iniciando");
  const child = spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(enabled ? { COMPRAFINO_PROGRESS: "1", COMPRAFINO_PROGRESS_MANAGED: "1" } : {}),
    },
  });
  const timer = setInterval(() => report("en ejecución"), 15_000);
  timer.unref();
  const forwardInterrupt = () => child.kill("SIGINT");
  const forwardTermination = () => child.kill("SIGTERM");
  process.on("SIGINT", forwardInterrupt);
  process.on("SIGTERM", forwardTermination);
  child.on("error", () => {
    report("no se pudo iniciar");
    process.exitCode = 1;
  });
  child.on("close", (code, signal) => {
    clearInterval(timer);
    process.off("SIGINT", forwardInterrupt);
    process.off("SIGTERM", forwardTermination);
    report(code === 0 ? "terminado" : "terminado con error");
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
}
