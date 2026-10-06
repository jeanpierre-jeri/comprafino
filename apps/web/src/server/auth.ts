// Next.js's compile-time guard intentionally has no exports.
// oxlint-disable-next-line import/no-unassigned-import
import "server-only";
import { createDatabase } from "@comprafino/db";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth-config.ts";

/** Credentials/database are required only when an auth request is made. */
let instance: ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>> | undefined;
export function getAuth() {
  instance ??= betterAuth(authOptions(createDatabase(), process.env));
  return instance;
}
