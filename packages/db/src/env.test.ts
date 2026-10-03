import { describe, expect, it } from "vitest";
import { requireDatabaseUrl } from "./env";
import { createDatabase } from "./index";

describe("database environment boundary", () => {
  it.each([undefined, "", "https://example.com", "not-a-url"])(
    "rejects invalid URLs without leaking their value",
    (url) => {
      expect(() => requireDatabaseUrl({ DATABASE_URL: url })).toThrow("DATABASE_URL is required");
    },
  );
  it("accepts PostgreSQL connection URLs", () => {
    const url = "postgresql://user:password@example.com/database?sslmode=require";
    expect(requireDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });
  it("validates configuration only when a client is requested", () => {
    expect(() => createDatabase({})).toThrow("DATABASE_URL is required");
  });
});
