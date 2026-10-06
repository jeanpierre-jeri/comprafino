import { describe, expect, it } from "vitest";
import { ownedTestDatabase } from "./testing/database.ts";
import { createTestQueryClient, validateLocalTestUrl } from "./testing/test-query-client.ts";

describe("local test database boundary", () => {
  it("accepts only loopback connections to the dedicated test database", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const url = `postgresql://comprafino_test@${host}:55432/comprafino_test`;
      expect(validateLocalTestUrl(url)).toBe(url);
    }

    for (const url of [
      "postgresql://user@production.example/comprafino_test",
      "postgresql://user@localhost/production",
      "https://localhost/comprafino_test",
      "postgresql://user@localhost/comprafino_test?host=production.example",
    ]) {
      expect(() => validateLocalTestUrl(url)).toThrow(/Local tests/u);
    }
  });
  it("requires explicit local mode and an isolated schema for web requests", () => {
    expect(() =>
      createTestQueryClient("postgresql://user@localhost/comprafino_test", "typo"),
    ).toThrow(/Unknown/u);
    expect(() =>
      ownedTestDatabase({ DATABASE_URL: "postgresql://user@localhost/comprafino_test" }),
    ).toThrow(/DATABASE_URL/u);
  });
});
