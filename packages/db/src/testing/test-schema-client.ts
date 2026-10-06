import { NeonQueryPromise } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";

/** Explicit browser-test isolation. Neon HTTP ignores URL search_path options.
 * Preserve lazy queries for Drizzle batches and scope direct awaits separately.
 */
export function testSchemaClient(client: NeonQueryFunction<false, false>, rawSchema: string) {
  const schema = z
    .string()
    .regex(/^comprafino_(?:e2e|test)_[0-9a-f]{32}$/u)
    .parse(rawSchema);
  const setPath = () => client.query("select set_config('search_path', $1, true)", [schema]);

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<typeof client.query>) => {
          const native = target.query(...args);

          return new NeonQueryPromise<boolean, boolean, unknown>(
            async () => {
              const results = await client.transaction(
                [setPath(), target.query(args[0], args[1])],
                args[2],
              );

              return results[1];
            },
            native.queryData,
            native.opts,
          );
        };
      }

      if (property !== "transaction") return Reflect.get(target, property, receiver);

      return async (
        queries: Parameters<typeof client.transaction>[0],
        options: Parameters<typeof client.transaction>[1],
      ) => {
        if (typeof queries === "function") {
          throw new Error("Isolated browser tests require batch queries");
        }

        const results = await client.transaction([setPath(), ...queries], options);

        return results.slice(1);
      };
    },
  });
}
