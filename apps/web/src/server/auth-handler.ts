import { toNextJsHandler } from "better-auth/next-js";
import type { betterAuth } from "better-auth";

/** Lazy initialization preserves credential-free public rendering/builds. */
export function authHandlers(auth: () => Pick<ReturnType<typeof betterAuth>, "handler">) {
  const handler = async (request: Request) => {
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
