import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { account, session, user, verification } from "@comprafino/db";
import type { createDatabase } from "@comprafino/db";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

/** Shared production configuration; tests supply only an owned, isolated database. */
export function authOptions(
  db: ReturnType<typeof createDatabase>,
  env: Record<string, string | undefined>,
) {
  function required(key: string) {
    const value = env[key]?.trim();

    if (!value) {
      throw new Error(`Missing ${key}`);
    }

    return value;
  }

  const secret = required("BETTER_AUTH_SECRET");

  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET requires at least 32 characters");
  }

  const baseURL = required("BETTER_AUTH_URL");
  const url = new URL(baseURL);

  if (
    url.origin !== baseURL ||
    url.username ||
    url.password ||
    url.hostname.includes("*") ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new Error("BETTER_AUTH_URL requires an HTTPS origin (HTTP is allowed on loopback)");
  }

  return {
    appName: "CompraFino",
    secret,
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
      // Neon HTTP supports batches, not the adapter's interactive transactions.
      transaction: false,
    }),
    advanced: { database: { generateId: "uuid" } },
    account: { encryptOAuthTokens: true },
    emailAndPassword: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ["/sign-in/social", "/link-social"].includes(ctx.path) &&
          (ctx.body?.scopes !== undefined || ctx.body?.additionalParams !== undefined)
        ) {
          // 1.7.7 accepts caller-supplied scopes and authorization parameters.
          // Keep Google scopes/access fixed by server configuration for this milestone.
          throw new APIError("BAD_REQUEST", { message: "OAuth parameters are server-configured" });
        }
      }),
    },
    socialProviders: {
      google: {
        clientId: required("GOOGLE_CLIENT_ID"),
        clientSecret: required("GOOGLE_CLIENT_SECRET"),
        disableDefaultScope: true,
        scope: ["openid", "email", "profile"],
        includeGrantedScopes: false,
        accessType: "online",
      },
    },
  } satisfies BetterAuthOptions;
}
