import { toNextJsHandler } from "better-auth/next-js";
import type { betterAuth } from "better-auth";
import { boundedJson } from "./request-body.ts";
import { withinRequestBudget } from "../lib/request-budget.ts";
import { publicRequestPolicy } from "../lib/public-request-policy.ts";

/** Lazy initialization preserves credential-free public rendering/builds. */
export function authHandlers(
  auth: (signal?: AbortSignal) => Pick<ReturnType<typeof betterAuth>, "handler">,
  deletionBudgetMs: number = publicRequestPolicy.operationMs,
) {
  const handler = async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/delete-user") {
      let dispatched = false;
      const reply = (code: string, status: number) =>
        Response.json(
          { code },
          {
            status,
            headers: { "Cache-Control": "private, no-store" },
          },
        );
      if (request.method !== "POST") return reply("METHOD_NOT_ALLOWED", 405);
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      ) {
        return reply("DELETE_INVALID_REQUEST", 415);
      }
      try {
        return await withinRequestBudget(deletionBudgetMs, request.signal, async (signal) => {
          const input = await boundedJson(request, signal);
          if ("status" in input) return reply("DELETE_INVALID_REQUEST", input.status);
          if (
            !input.body ||
            typeof input.body !== "object" ||
            Array.isArray(input.body) ||
            Object.keys(input.body).length
          ) {
            return reply("DELETE_INVALID_REQUEST", 400);
          }
          signal.throwIfAborted();
          dispatched = true;
          const response = await auth(signal).handler(
            new Request(request.url, {
              method: "POST",
              headers: request.headers,
              body: "{}",
              signal,
            }),
          );
          const headers = new Headers(response.headers);
          // A delayed deletion reply must not erase a different account's new
          // cookie. Session invalidation happens in the database; the client
          // refreshes current authentication independently after the outcome.
          headers.delete("set-cookie");
          headers.set("Cache-Control", "private, no-store");
          return new Response(response.body, { status: response.status, headers });
        });
      } catch {
        return reply(dispatched ? "DELETE_UNCERTAIN" : "DELETE_UNAVAILABLE", 503);
      }
    }
    try {
      return await toNextJsHandler(auth()).GET(request);
    } catch {
      return Response.json(
        { error: "Inicio de sesión no disponible. Intenta nuevamente." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };

  return { GET: handler, POST: handler };
}
