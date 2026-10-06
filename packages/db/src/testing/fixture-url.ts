import { validateLocalTestUrl } from "./test-query-client.ts";

/** Neon derives an HTTP endpoint from its host; an IPv4-derived api.0.0.1 is
 * invalid to Next's fetch wrapper before injection can run. A reserved .invalid
 * hostname keeps that wire API valid; the preload alone maps it to owned TCP.
 */
export function fixtureDatabaseUrl(url: string, mode: string | undefined) {
  if (mode !== "local") return url;

  const fixture = new URL(validateLocalTestUrl(url));
  fixture.hostname = "fixture.neon.invalid";
  fixture.port = "";

  return fixture.href;
}
