import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { account, session, user, verification } from "@comprafino/db";
import type { createDatabase } from "@comprafino/db";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";

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
    user: { deleteUser: { enabled: true } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // There is no deletion-token/email flow in this application. Keep the
        // native API's authoritative-session/freshness checks, and bind the
        // explicit confirmation to the initiating account AND session.
        if (ctx.path === "/delete-user/callback") {
          throw new APIError("FORBIDDEN", {
            code: "DELETE_CONFIRMATION_REQUIRED",
            message: "Use account confirmation",
          });
        }
        if (ctx.path === "/delete-user") {
          if (
            ctx.headers?.get("origin") !== baseURL ||
            ctx.headers.get("x-comprafino-confirm-delete") !== "delete-own-account"
          ) {
            throw new APIError("FORBIDDEN", {
              code: "DELETE_CONFIRMATION_REQUIRED",
              message: "Account confirmation required",
            });
          }
          if (Object.keys(ctx.body ?? {}).length) {
            throw new APIError("BAD_REQUEST", {
              code: "DELETE_INVALID_REQUEST",
              message: "Deletion parameters are server-configured",
            });
          }
          const current = await getAuthoritativeSessionFromCtx(ctx);
          if (!current) {
            throw new APIError("UNAUTHORIZED", {
              code: "UNAUTHORIZED",
              message: "Session unavailable",
            });
          }
          if (
            ctx.headers.get("x-comprafino-delete-session") !== current.session.id ||
            ctx.headers.get("x-comprafino-delete-owner") !== current.user.id
          ) {
            throw new APIError("CONFLICT", {
              code: "ACCOUNT_SESSION_CHANGED",
              message: "Account or session changed",
            });
          }
        }
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
