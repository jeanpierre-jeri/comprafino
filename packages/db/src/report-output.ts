import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Explicit destinations may include reviewed docs; all writes refuse replacement. */
export function reportOutputPath(args: readonly string[], now = new Date()): string {
  const options = args.filter((arg) => arg !== "--");

  if (options.length > 1 || (options.length === 1 && !options[0]!.startsWith("--output="))) {
    throw new Error("Use --output=<repository-relative-or-absolute-path>");
  }

  const destination = options[0]?.slice("--output=".length);

  if (destination === "") {
    throw new Error("Output path cannot be empty");
  }

  return resolve(
    repositoryRoot,
    destination ?? `.artifacts/basket-${now.toISOString().replaceAll(":", "-")}.json`,
  );
}

export function writeReport(path: string, report: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
