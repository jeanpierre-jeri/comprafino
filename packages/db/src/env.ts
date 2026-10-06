import { z } from "zod";

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });

export function requireDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const result = databaseUrl.safeParse(env.DATABASE_URL);

  if (!result.success) {
    throw new Error(
      "DATABASE_URL is required and must be a valid postgresql:// or postgres:// connection URL. Copy .env.example to .env and configure your database.",
    );
  }

  return result.data;
}
