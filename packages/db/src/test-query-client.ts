import { neon, NeonQueryPromise, types } from "@neondatabase/serverless";
import type { HTTPQueryOptions, ParameterizedQuery, SqlTemplate } from "@neondatabase/serverless";
import { Pool } from "pg";
import type { PoolClient } from "pg";

const pools = new Map<string, Pool>();

/** Local TCP is opt-in and confined to the disposable Docker test database. */
export function validateLocalTestUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/comprafino_test" ||
    url.search !== ""
  ) {
    throw new Error("Local tests require a loopback URL for the comprafino_test database");
  }
  return rawUrl;
}

/** Preserve Drizzle's lazy Neon batch interface while executing local tests over TCP. */
export function createTestQueryClient(url: string, mode: string | undefined) {
  if (mode === undefined) return neon(url);
  if (mode !== "local") throw new Error("Unknown COMPRAFINO_TEST_DATABASE_MODE");
  validateLocalTestUrl(url);
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 4, allowExitOnIdle: true });
    pools.set(url, pool);
  }
  const localPool = pool;
  const native = neon(url);
  async function execute(
    connection: Pool | PoolClient,
    data: ParameterizedQuery | SqlTemplate,
    options: HTTPQueryOptions<boolean, boolean> = {},
  ) {
    const query = "query" in data ? data : data.toParameterizedQuery();
    const result = await connection.query<Record<string, unknown>>({
      text: query.query,
      values: query.params,
      ...(options.arrayMode ? { rowMode: "array" } : {}),
      types: options.types ?? types,
    });
    return options.fullResults ? result : result.rows;
  }
  return new Proxy(native, {
    apply() {
      throw new Error("Local test transport requires parameterized .query() calls");
    },
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<typeof native.query>) => {
          const query = target.query(...args);
          return new NeonQueryPromise<boolean, boolean, unknown>(
            () => execute(localPool, query.queryData, query.opts),
            query.queryData,
            query.opts,
          );
        };
      }
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (
        queries: Parameters<typeof native.transaction>[0],
        options: Parameters<typeof native.transaction>[1] = {},
      ) => {
        if (typeof queries === "function") throw new Error("Local tests require batch queries");
        const connection = await localPool.connect();
        try {
          await connection.query("BEGIN");
          if (options.isolationLevel || options.readOnly || options.deferrable)
            throw new Error("Local test transport supports default transaction options only");
          const results: unknown[] = [];
          for (const query of queries) {
            results.push(await execute(connection, query.queryData, { ...options, ...query.opts }));
          }
          await connection.query("COMMIT");
          return results;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
      };
    },
  });
}

export async function closeLocalTestConnections() {
  const current = [...pools.values()];
  pools.clear();
  await Promise.all(current.map((pool) => pool.end()));
}
