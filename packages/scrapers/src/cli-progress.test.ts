import { afterEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCliProgress } from "../../../scripts/cli-progress.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function localEnvironment() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CI", undefined);
  vi.stubEnv("GITHUB_ACTIONS", undefined);
  vi.stubEnv("COMPRAFINO_PROGRESS", "1");
}

it("shows real counts, throttles updates, and always displays a new phase and completion", () => {
  localEnvironment();
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const progress = createCliProgress();
  progress("Páginas", 0, 100);
  progress("Páginas", 1, 100);
  progress("Páginas", 100, 100);
  progress("Matching", 4, undefined, "registros procesados");
  expect(write).toHaveBeenCalledTimes(3);
  expect(write.mock.calls.map(([message]) => message)).toEqual([
    expect.stringContaining("0/100 (0%)"),
    expect.stringContaining("100/100 (100%)"),
    expect.stringContaining("Matching | 4 | registros procesados"),
  ]);
});

it.each([
  ["CI", "true"],
  ["GITHUB_ACTIONS", "true"],
  ["NODE_ENV", "production"],
  ["COMPRAFINO_PROGRESS", "0"],
])("suppresses human progress when %s=%s even when explicitly enabled", (key, value) => {
  localEnvironment();
  vi.stubEnv(key, value);
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  createCliProgress()("Páginas", 1, 10);
  expect(write).not.toHaveBeenCalled();
});

it.each([0, 7])("preserves command output, arguments and exit status %i", (exitCode) => {
  const wrapper = fileURLToPath(new URL("../../../scripts/run-command.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      process.execPath,
      "-e",
      `console.log(process.argv[1]); process.exit(${exitCode})`,
      "private argument $() `literal`",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, CI: "true", COMPRAFINO_PROGRESS: "1" },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(exitCode);
  expect(result.stdout).toBe("private argument $() `literal`\n");
  expect(result.stderr).toBe("");
});

it("reports command lifecycle locally without logging arguments", () => {
  const wrapper = fileURLToPath(new URL("../../../scripts/run-command.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [wrapper, process.execPath, "-e", "", "private-value"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "",
        GITHUB_ACTIONS: "",
        NODE_ENV: "test",
        COMPRAFINO_PROGRESS: "1",
        COMPRAFINO_PROGRESS_MANAGED: "",
        npm_lifecycle_event: "audit:test",
      },
    },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("[audit:test] iniciando");
  expect(result.stderr).toContain("[audit:test] terminado");
  expect(result.stderr).not.toContain("private-value");
});
