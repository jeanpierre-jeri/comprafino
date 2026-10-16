// Next.js's compile-time guard intentionally has no exports.
// oxlint-disable-next-line import/no-unassigned-import
import "server-only";
import { createDatabase } from "@comprafino/db";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth-config.ts";
import { publicDatabaseOptions } from "./public-database.ts";

/** Credentials/database are required only when an auth request is made. */
let instance: ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>> | undefined;

export function getAuth(signal?: AbortSignal) {
  // A sync request must never install its signal into the shared auth singleton.
  if (signal) {
    return betterAuth(
      authOptions(createDatabase(process.env, publicDatabaseOptions(signal)), process.env),
    );
  }

  instance ??= betterAuth(authOptions(createDatabase(), process.env));

  return instance;
}
