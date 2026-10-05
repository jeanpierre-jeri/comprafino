import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";

const excluded = new Set(["node_modules", ".next", ".turbo", "test-results", "playwright-report"]);
function collect(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? collect(child) : [child];
  });
}
const files = [
  "README.md",
  "AGENTS.md",
  ...["docs", "packages", "apps/web/src", "apps/web/e2e"].flatMap(collect),
];
const failures = [];
const slugs = (text) => {
  const counts = new Map();
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) => {
      const slug = match[1]
        .replace(/<[^>]*>/gu, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .replace(/\s/gu, "-");
      const count = counts.get(slug) ?? 0;
      counts.set(slug, count + 1);
      return count ? `${slug}-${count}` : slug;
    }),
  );
};
for (const file of files.filter((path) => path.endsWith(".md"))) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (/^[a-z]+:/iu.test(target)) continue;
    const [path, anchor] = target.split("#");
    const destination = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
    if (!existsSync(destination)) failures.push(`${file}: missing ${target}`);
    else if (
      anchor &&
      extname(destination) === ".md" &&
      !slugs(readFileSync(destination, "utf8")).has(decodeURIComponent(anchor))
    )
      failures.push(`${file}: missing anchor ${target}`);
  }
}
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
for (const match of readFileSync("README.md", "utf8").matchAll(/(?:^|`)pnpm ([a-z][\w:-]*)/gmu)) {
  if (!scripts[match[1]] && !["install"].includes(match[1]))
    failures.push(`README.md: unknown pnpm command ${match[1]}`);
}
// Check literal runtime artifact/config URLs; dynamic fixture/migration paths remain owned by their tests.
for (const file of files.filter(
  (path) => /\.(?:ts|tsx|mjs)$/u.test(path) && !path.startsWith("scripts/"),
)) {
  for (const match of readFileSync(file, "utf8").matchAll(
    /new URL\("([^"$]+\.(?:json|ya?ml))", import\.meta\.url\)/gu,
  )) {
    if (!existsSync(resolve(dirname(file), match[1])))
      failures.push(`${file}: missing runtime file ${match[1]}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Markdown paths/anchors, README commands and literal runtime artifact references resolve.",
  );
