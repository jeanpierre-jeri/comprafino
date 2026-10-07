import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

for (const [workflow, command, expectedArguments] of [
  ["refresh-catalog.yml", "refresh:catalog", "refresh:catalog"],
  ["discover-catalog.yml", "discover:catalog", "discover:catalog -- --limit=10"],
] as const) {
  it(`${workflow} preserves acquisition arguments and failure status while recording stdout`, () => {
    const directory = mkdtempSync(join(tmpdir(), "comprafino-health-workflow-"));
    try {
      const workflowText = readFileSync(
        new URL(`../../../.github/workflows/${workflow}`, import.meta.url),
        "utf8",
      );
      const runLines = workflowText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith(`run: pnpm ${command}`));
      expect(runLines).toHaveLength(1);
      const run = runLines[0]!.slice("run: ".length);
      // The fake pnpm cannot acquire data or access a database. Exercise the
      // actual workflow pipeline under GitHub's explicit Bash failure flags.
      const result = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-e",
          "-o",
          "pipefail",
          "-c",
          `pnpm() { printf '%s\\n' "$*"; return 7; }\n${run}`,
        ],
        {
          cwd: directory,
          env: { PATH: process.env.PATH, RUNNER_TEMP: directory },
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(7);
      expect(readFileSync(join(directory, "catalog-acquisition.log"), "utf8").trim()).toBe(
        expectedArguments,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
