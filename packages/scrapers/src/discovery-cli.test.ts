import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  ["--", "--limit=100"],
  ["--dry-run", "--limit=0"],
  ["--limit=3", "--limit=4"],
  ["--unknown=private-input"],
  ["--manual", "--limit=100"],
  ["--manual", "--manual"],
])("reports invalid discovery options before database configuration: %j", (...args) => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("./discovery-cli.ts", import.meta.url)),
      ...args,
    ],
    {
      env: { ...process.env, DATABASE_URL: "invalid-private-database-url" },
      encoding: "utf8",
      timeout: 10_000,
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("invalid_discovery_options");
  expect(result.stderr).toContain("--limit=1..30");
  expect(result.stderr).not.toMatch(/db_read_failed|private-input|invalid-private-database-url/u);
});
