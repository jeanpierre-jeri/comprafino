import { readFileSync, writeFileSync } from "node:fs";
import {
  createHostingFixtures,
  scaleHostingFixtures,
  removeHostingFixtures,
  openHostingFixtures,
  hostingFixtureStorage,
} from "./fixtures.ts";
import { closeLocalTestConnections } from "../test-query-client.ts";

const [command, path, argument, ...extra] = process.argv.slice(2);
if (!path || extra.length || !["seed", "scale", "inspect", "clean"].includes(command ?? "")) {
  throw new Error("Use seed STATE COMMIT | scale STATE SIZE | inspect STATE | clean STATE");
}
try {
  if (command === "seed") {
    // Reserve the manifest before writing to any database; never overwrite ownership.
    writeFileSync(path, "{}\n", { flag: "wx", mode: 0o600 });
    const state = await createHostingFixtures(argument ?? "", process.env, (owner) => {
      writeFileSync(path, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
    });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(state)}\n`);
  } else {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (command === "scale") {
      const result = await scaleHostingFixtures(value, Number(argument));
      writeFileSync(path, `${JSON.stringify(result.state, null, 2)}\n`, { mode: 0o600 });
      process.stdout.write(
        `${JSON.stringify({ size: result.state.size, counts: result.counts, storageBytes: result.storage })}\n`,
      );
    } else if (command === "inspect") {
      const harness = await openHostingFixtures(value);
      process.stdout.write(
        `${JSON.stringify({ ...harness.state, storageBytes: await hostingFixtureStorage(harness) })}\n`,
      );
    } else {
      await removeHostingFixtures(value);
      process.stdout.write(
        "Owned test schema removed. Remote database and Vercel project unchanged.\n",
      );
    }
  }
} catch {
  // Driver errors may contain a connection URL. Keep credentials out of logs.
  process.stderr.write(
    "Hosting fixture command failed; check explicit test configuration and ownership.\n",
  );
  process.exitCode = 1;
} finally {
  await closeLocalTestConnections();
}
