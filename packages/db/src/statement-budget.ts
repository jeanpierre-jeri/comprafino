import { NeonQueryPromise } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// pg_settings.setting exposes milliseconds independent of SHOW's display unit.
// LEAST ignores the NULL representing an existing unlimited (zero) timeout.
export const statementBudgetSql = `select set_config('statement_timeout',
  least(nullif(setting::bigint, 0), $1::bigint)::text, true)
  from pg_settings where name = 'statement_timeout'`;

/** SET LOCAL must share the query's HTTP transaction; a separate request or URL
 * option does not reliably configure the connection chosen by the Neon proxy.
 * This bounds each statement, not the sum of every statement in a batch.
 */
export function withStatementBudget(client: NeonQueryFunction<false, false>, milliseconds: number) {
  const configure = () => client.query(statementBudgetSql, [String(milliseconds)]);

  return new Proxy(client, {
    apply(target, _receiver, args: Parameters<typeof client>) {
      const native = target(...args);

      return new NeonQueryPromise<false, false, unknown>(
        async () => (await client.transaction([configure(), native]))[1],
        native.queryData,
        native.opts,
      );
    },
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<typeof client.query>) => {
          const native = target.query(...args);

          return new NeonQueryPromise<boolean, boolean, unknown>(
            async () => {
              const results = await client.transaction(
                [configure(), target.query(args[0], args[1])],
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
        const results = await client.transaction(
          typeof queries === "function"
            ? (transaction) => [
                transaction.query(statementBudgetSql, [String(milliseconds)]),
                ...queries(transaction),
              ]
            : [configure(), ...queries],
          options,
        );

        return results.slice(1);
      };
    },
  });
}
