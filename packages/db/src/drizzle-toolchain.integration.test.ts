import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";

const databaseDirectory = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const kitRequire = createRequire(require.resolve("drizzle-kit"));
const loaderPath = kitRequire.resolve("@esbuild-kit/esm-loader");
const localConfigured =
  Boolean(process.env.TEST_DATABASE_URL) && process.env.COMPRAFINO_TEST_DATABASE_MODE === "local";

function runTool(args: string[]) {
  const result = spawnSync("pnpm", ["exec", ...args], {
    cwd: databaseDirectory,
    encoding: "utf8",
    timeout: 45_000,
    // Fixture configs use only the explicit local test URL, never root .env.
    env: { ...process.env, DATABASE_URL: undefined },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

it.skipIf(!localConfigured)(
  "Drizzle generation, migration and the transitive ESM loader work in an owned local fixture",
  async () => {
    const harness = ownedTestDatabase();
    const artifacts = join(databaseDirectory, ".artifacts");
    await mkdir(artifacts, { recursive: true });
    const directory = await mkdtemp(join(artifacts, "drizzle-toolchain-"));
    try {
      await harness.setup();
      await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
      await writeFile(
        join(directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { jsx: "react", target: "es2022" } }),
      );
      await writeFile(
        join(directory, "value.ts"),
        "enum Quantity { six = 6 }; export const value: number = Quantity.six * 7;",
      );
      await writeFile(
        join(directory, "loader.tsx"),
        `import assert from 'node:assert/strict';
import { value } from './value.ts';
const React = { createElement: (_tag: string, _props: unknown, child: number) => child };
const rendered = <probe>{value}</probe>;
assert.equal(rendered, 42);
assert.equal((await import('./value.ts')).value, 42);
console.log('loader-tsx-dynamic-import-ok');`,
      );
      expect(runTool(["node", "--loader", loaderPath, join(directory, "loader.tsx")])).toContain(
        "loader-tsx-dynamic-import-ok",
      );

      const schemaPath = join(directory, "schema.ts");
      const migrations = join(directory, "migrations");
      const configPath = join(directory, "drizzle.config.ts");
      const connection = new URL(harness.url);
      connection.searchParams.set("options", `-csearch_path=${harness.schema}`);
      await writeFile(
        schemaPath,
        `import { pgTable, integer, text } from 'drizzle-orm/pg-core';
export const probe = pgTable('dependency_toolchain_probe', {
  id: integer('id').primaryKey(), label: text('label').notNull()
});`,
      );
      await writeFile(
        configPath,
        `export default ${JSON.stringify({
          dialect: "postgresql",
          schema: schemaPath,
          out: relative(databaseDirectory, migrations),
          dbCredentials: { url: connection.toString() },
          migrations: { schema: harness.schema },
        })};`,
      );
      runTool(["drizzle-kit", "generate", "--config", configPath]);
      const generated = (await readdir(migrations)).filter((name) => name.endsWith(".sql"));
      expect(generated).toHaveLength(1);
      const migrationPath = join(migrations, generated[0]!);
      const sql = await readFile(migrationPath, "utf8");
      expect(sql).toContain('CREATE TABLE "dependency_toolchain_probe"');
      expect(sql).not.toContain('"public".');
      // Fail before table DDL if the CLI driver loses our owned search_path.
      // Its migration journal is explicitly scoped to the same owned schema.
      const guard = `DO $guard$ BEGIN
IF current_schema() IS DISTINCT FROM '${harness.schema}' THEN
  RAISE EXCEPTION 'Owned test schema required';
END IF;
END $guard$;\n--> statement-breakpoint\n`;
      await writeFile(migrationPath, guard + sql);
      expect(runTool(["drizzle-kit", "migrate", "--config", configPath])).toContain(
        "migrations applied successfully",
      );
      await harness.scoped.query("insert into dependency_toolchain_probe(id,label) values($1,$2)", [
        42,
        "isolated migration",
      ]);
      expect(await harness.scoped.query("select * from dependency_toolchain_probe")).toEqual([
        { id: 42, label: "isolated migration" },
      ]);
      expect(runTool(["drizzle-kit", "migrate", "--config", configPath])).toContain(
        "migrations applied successfully",
      );
      expect(
        await harness.scoped.query("select count(*)::int as count from __drizzle_migrations"),
      ).toEqual([{ count: 1 }]);

      // Exercise the actual project schema against copied snapshots only.
      const projectMigrations = join(directory, "project-migrations");
      await cp(join(databaseDirectory, "migrations"), projectMigrations, { recursive: true });
      const journalPath = join(projectMigrations, "meta", "_journal.json");
      const journalBefore = await readFile(journalPath, "utf8");
      await writeFile(
        configPath,
        `export default ${JSON.stringify({
          dialect: "postgresql",
          schema: join(databaseDirectory, "src", "schema.ts"),
          out: relative(databaseDirectory, projectMigrations),
        })};`,
      );
      expect(runTool(["drizzle-kit", "generate", "--config", configPath])).toContain(
        "No schema changes",
      );
      expect(await readFile(journalPath, "utf8")).toBe(journalBefore);
    } finally {
      try {
        await harness.dispose();
        expect(
          await harness.client.query(
            "select schema_name from information_schema.schemata where schema_name=$1",
            [harness.schema],
          ),
        ).toEqual([]);
      } finally {
        await closeLocalTestConnections();
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  120_000,
);
