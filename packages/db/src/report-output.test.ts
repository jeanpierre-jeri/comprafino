import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { reportOutputPath, writeReport } from "./report-output.ts";

it("defaults outside reviewed docs and supports explicit destinations", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  expect(reportOutputPath([], now)).toContain("/.artifacts/basket-2026-10-05T12-00-00.000Z.json");
  expect(reportOutputPath(["--", "--output=.artifacts/local.json"])).toMatch(
    /\/\.artifacts\/local\.json$/u,
  );
  expect(reportOutputPath(["--output=/tmp/explicit.json"])).toBe("/tmp/explicit.json");

  for (const args of [["--output="], ["--unknown"], ["--output=a", "--output=b"]]) {
    expect(() => reportOutputPath(args)).toThrow(/Output path|Use --output/u);
  }
});

it("creates new reports and refuses to replace reviewed evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "comprafino-report-"));
  const path = join(directory, "nested", "baseline.json");

  try {
    writeReport(path, { measuredAt: "original", durationMs: 100 });
    const original = readFileSync(path, "utf8");
    expect(() => writeReport(path, { measuredAt: "replacement" })).toThrow(/EEXIST/u);
    expect(readFileSync(path, "utf8")).toBe(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
